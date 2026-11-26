import { useEffect, useRef, useState, useCallback } from 'react';
import { db } from '../firebase';
import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  query,
  where,
} from 'firebase/firestore';
import type { DocumentReference, Unsubscribe } from 'firebase/firestore';

const servers: RTCConfiguration = {
  iceServers: [
    {
      urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'],
    },
  ],
};

/*
 * 信令協定（以 session 為單位）：
 * - 房主每次開始分享、或收到訪客的 joinRequest 時，都會「整個重建」PeerConnection，
 *   並產生新的 session id，寫入 room.session = { id, offer }。
 * - 訪客看到新的 session id 就重建自己的 PeerConnection，回寫 room.answer = { session, ... }。
 * - ICE candidates 都帶 session 欄位，雙方只收同一個 session 的 candidate。
 * 這樣可避免舊的 offer / answer / candidate 殘留在 Firestore 導致連線卡在 new。
 */

function newId() {
  return Math.random().toString(36).substring(2, 12) + Date.now().toString(36);
}

/**
 * 清除 Firestore 中的信令資料
 */
async function cleanSignaling(roomRef: DocumentReference) {
  const callerCands = await getDocs(collection(roomRef, 'callerCandidates'));
  const calleeCands = await getDocs(collection(roomRef, 'calleeCandidates'));
  const deletions: Promise<void>[] = [];
  callerCands.forEach(d => deletions.push(deleteDoc(d.ref)));
  calleeCands.forEach(d => deletions.push(deleteDoc(d.ref)));
  await Promise.all(deletions);

  await updateDoc(roomRef, {
    session: deleteField(),
    answer: deleteField(),
    // 舊版欄位
    offer: deleteField(),
  });
}

// 房主標記存在 sessionStorage：只有從首頁「建立房間」的分頁是房主，
// 重新整理仍保留；用邀請連結開新分頁 / 其他瀏覽器則是訪客。
const hostKey = (roomId: string) => `remoteu_host_${roomId}`;

export function markAsHost(roomId: string) {
  try {
    sessionStorage.setItem(hostKey(roomId), '1');
  } catch {
    // 無法寫入 sessionStorage 時視為訪客
  }
}

function isHostTab(roomId: string) {
  try {
    return sessionStorage.getItem(hostKey(roomId)) === '1';
  } catch {
    return false;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

export type Role = 'pending' | 'host' | 'guest';

export function useWebRTC(roomId: string, password: string) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<Role>('pending');
  const [connectionState, setConnectionState] = useState<string>('new');

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const sessionUnsubs = useRef<Unsubscribe[]>([]);
  const roomRefCache = useRef<DocumentReference | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  // 關閉目前的 PeerConnection 與該 session 的監聽
  const closeSession = useCallback(() => {
    sessionUnsubs.current.forEach(unsub => unsub());
    sessionUnsubs.current = [];
    if (pcRef.current) {
      pcRef.current.onicecandidate = null;
      pcRef.current.ontrack = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.close();
      pcRef.current = null;
    }
    sessionIdRef.current = null;
    setConnectionState('new');
  }, []);

  /**
   * 建立一個新的 PeerConnection，並監聽對方同 session 的 ICE candidates。
   * 回傳的 markRemoteReady 須在 setRemoteDescription 後呼叫，以加入緩衝中的 candidate。
   */
  const createSessionPc = useCallback((
    roomRef: DocumentReference,
    sessionId: string,
    localCollection: string,
    remoteCollection: string,
  ) => {
    const pc = new RTCPeerConnection(servers);
    pcRef.current = pc;
    sessionIdRef.current = sessionId;

    pc.onconnectionstatechange = () => setConnectionState(pc.connectionState);
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        addDoc(collection(roomRef, localCollection), {
          ...event.candidate.toJSON(),
          session: sessionId,
        }).catch(e => console.error('write candidate error:', e));
      }
    };

    // ICE candidate 緩衝：remoteDescription 設定完成前先存起來
    const pending: RTCIceCandidateInit[] = [];
    let remoteReady = false;
    const addCandidate = (c: RTCIceCandidateInit) => {
      if (pc.signalingState === 'closed') return;
      pc.addIceCandidate(new RTCIceCandidate(c)).catch(e => console.error('addIceCandidate error:', e));
    };

    const q = query(collection(roomRef, remoteCollection), where('session', '==', sessionId));
    const unsub = onSnapshot(q, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type !== 'added') return;
        const { session: _session, ...candidate } = change.doc.data();
        if (remoteReady) addCandidate(candidate as RTCIceCandidateInit);
        else pending.push(candidate as RTCIceCandidateInit);
      });
    });
    sessionUnsubs.current.push(unsub);

    const markRemoteReady = () => {
      remoteReady = true;
      pending.splice(0).forEach(addCandidate);
    };

    return { pc, markRemoteReady };
  }, []);

  // ---- 房主：用目前的本地串流建立新 session 並送出 offer ----
  const hostMarkRemoteReady = useRef<(() => void) | null>(null);

  const hostNegotiate = useCallback(async () => {
    const roomRef = roomRefCache.current;
    const stream = localStreamRef.current;
    if (!roomRef || !stream) return;

    closeSession();
    const sessionId = newId();
    const { pc, markRemoteReady } = createSessionPc(roomRef, sessionId, 'callerCandidates', 'calleeCandidates');
    hostMarkRemoteReady.current = markRemoteReady;

    stream.getTracks().forEach(track => pc.addTrack(track, stream));

    try {
      const offer = await pc.createOffer();
      if (sessionIdRef.current !== sessionId) return;
      await pc.setLocalDescription(offer);
      await updateDoc(roomRef, {
        session: { id: sessionId, offer: { type: offer.type, sdp: offer.sdp } },
        answer: deleteField(),
      });
    } catch (err) {
      console.error('Error creating offer:', err);
    }
  }, [closeSession, createSessionPc]);

  // ---- 訪客：收到新 session 的 offer 後建立連線並回覆 answer ----
  const guestHandleSession = useCallback(async (
    roomRef: DocumentReference,
    session: { id: string; offer: RTCSessionDescriptionInit } | undefined,
  ) => {
    if (!session?.id) {
      if (sessionIdRef.current) {
        closeSession();
        setRemoteStream(null);
      }
      return;
    }
    if (session.id === sessionIdRef.current) return;

    closeSession();
    setRemoteStream(null);
    const sessionId = session.id;
    const { pc, markRemoteReady } = createSessionPc(roomRef, sessionId, 'calleeCandidates', 'callerCandidates');

    const remote = new MediaStream();
    pc.ontrack = (event) => {
      remote.addTrack(event.track);
      setRemoteStream(new MediaStream(remote.getTracks()));
    };

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(session.offer));
      markRemoteReady();
      const answer = await pc.createAnswer();
      if (sessionIdRef.current !== sessionId) return;
      await pc.setLocalDescription(answer);
      await updateDoc(roomRef, {
        answer: { session: sessionId, type: answer.type, sdp: answer.sdp },
      });
    } catch (err) {
      console.error('Callee handleOffer error:', err);
    }
  }, [closeSession, createSessionPc]);

  useEffect(() => {
    if (!roomId || !password) return;

    let cancelled = false;
    let isHost = false;
    let unsubRoom: Unsubscribe | null = null;
    const roomRef = doc(db, 'rooms', roomId);
    roomRefCache.current = roomRef;

    const init = async () => {
      const hostTab = isHostTab(roomId);
      // Firestore 連不上（例如額度用完）時 SDK 會無限重試，這裡加逾時讓使用者看到錯誤
      const roomSnap = await withTimeout(getDoc(roomRef), 10000);
      if (cancelled) return;

      if (!roomSnap.exists()) {
        if (!hostTab) {
          setError('房間不存在或已關閉');
          return;
        }
        isHost = true;
        await withTimeout(setDoc(roomRef, { password, createdAt: Date.now() }), 10000);
      } else {
        const data = roomSnap.data();
        if (data.password !== password) {
          setError('密碼錯誤');
          return;
        }
        // 房主重新整理 → 清掉舊信令
        isHost = hostTab;
        if (isHost) await cleanSignaling(roomRef);
      }
      if (cancelled) return;
      setRole(isHost ? 'host' : 'guest');

      if (isHost) {
        let lastJoinRequest: number | undefined;
        unsubRoom = onSnapshot(roomRef, async (snapshot) => {
          const data = snapshot.data();
          if (!data) return;

          // 訪客（重新）加入 → 若正在分享就重新建立 session
          const joinRequest = data.joinRequest as number | undefined;
          if (joinRequest !== lastJoinRequest) {
            lastJoinRequest = joinRequest;
            if (localStreamRef.current) {
              hostNegotiate();
              return;
            }
          }

          const answer = data.answer;
          const pc = pcRef.current;
          if (
            pc &&
            answer?.session &&
            answer.session === sessionIdRef.current &&
            pc.signalingState === 'have-local-offer'
          ) {
            try {
              await pc.setRemoteDescription(new RTCSessionDescription({ type: answer.type, sdp: answer.sdp }));
              hostMarkRemoteReady.current?.();
            } catch (e) {
              console.error('Caller setRemoteDescription error:', e);
            }
          }
        });
      } else {
        // 通知房主有訪客加入，讓房主針對這個訪客重新送 offer
        await updateDoc(roomRef, { joinRequest: Date.now() });
        if (cancelled) return;
        unsubRoom = onSnapshot(roomRef, (snapshot) => {
          guestHandleSession(roomRef, snapshot.data()?.session);
        });
      }
    };

    init().catch(e => {
      console.error('initRoom error:', e);
      if (cancelled) return;
      const code = (e as { code?: string })?.code;
      setError(
        code === 'resource-exhausted' || (e as Error)?.message === 'timeout'
          ? '無法連線至伺服器（Firestore 今日額度可能已用完，請稍後再試）'
          : '無法連線至房間'
      );
    });

    return () => {
      cancelled = true;
      unsubRoom?.();
      closeSession();
      localStreamRef.current?.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
      setLocalStream(null);
      setRemoteStream(null);
      setRole('pending');
      if (isHost) {
        cleanSignaling(roomRef).catch(e => console.error('cleanup error:', e));
      }
    };
  }, [roomId, password, closeSession, hostNegotiate, guestHandleSession]);

  const stopScreenShare = useCallback(() => {
    localStreamRef.current?.getTracks().forEach(track => track.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    closeSession();
    if (roomRefCache.current) {
      updateDoc(roomRefCache.current, {
        session: deleteField(),
        answer: deleteField(),
      }).catch(e => console.error('stop share error:', e));
    }
  }, [closeSession]);

  const startScreenShare = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      localStreamRef.current = stream;
      setLocalStream(stream);
      stream.getVideoTracks().forEach((track) => {
        track.onended = () => {
          if (localStreamRef.current === stream) stopScreenShare();
        };
      });
      await hostNegotiate();
    } catch (err) {
      console.error('取得螢幕分享失敗:', err);
    }
  }, [hostNegotiate, stopScreenShare]);

  return { localStream, remoteStream, error, role, isCaller: role === 'host', connectionState, startScreenShare, stopScreenShare };
}
