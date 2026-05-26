import {
  doc, setDoc, deleteDoc, getDoc, onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from './firebase.js';

const AGORA_APP_ID = '0810267927b4400490af954557a44417';

export const roomState = {
  client: null,
  localAudioTrack: null,
  localVideoTrack: null,
  remoteUsers: new Map(),
  activeRoomId: null
};

let roomCbs = {};

async function cleanupRoomTracks() {
  if (roomState.localAudioTrack) {
    roomState.localAudioTrack.stop();
    roomState.localAudioTrack.close();
    roomState.localAudioTrack = null;
  }
  if (roomState.localVideoTrack) {
    roomState.localVideoTrack.stop();
    roomState.localVideoTrack.close();
    roomState.localVideoTrack = null;
  }
  if (roomState.client) {
    try { await roomState.client.leave(); } catch (_) {}
    roomState.client = null;
  }
  roomState.remoteUsers.clear();
}

async function joinChannel(channelName, userCallingId, localContainer, remoteGrid) {
  const AgoraRTC = window.AgoraRTC;
  if (!AgoraRTC) throw new Error('Agora SDK not loaded');

  const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
  roomState.client = client;

  client.on('user-published', async (user, mediaType) => {
    await client.subscribe(user, mediaType);
    if (mediaType === 'video') {
      let tile = document.getElementById(`rtile-${user.uid}`);
      if (!tile) {
        tile = document.createElement('div');
        tile.id = `rtile-${user.uid}`;
        tile.className = 'room-tile';
        remoteGrid.appendChild(tile);
      }
      user.videoTrack.play(tile);
      roomState.remoteUsers.set(user.uid, user);
      roomCbs.onUserJoined?.();
    }
    if (mediaType === 'audio') {
      user.audioTrack?.play();
    }
  });

  client.on('user-unpublished', (user, mediaType) => {
    if (mediaType === 'video') {
      const tile = document.getElementById(`rtile-${user.uid}`);
      if (tile) tile.innerHTML = '';
    }
  });

  client.on('user-left', (user) => {
    const tile = document.getElementById(`rtile-${user.uid}`);
    if (tile) tile.remove();
    roomState.remoteUsers.delete(user.uid);
    roomCbs.onUserLeft?.();
  });

  await client.join(AGORA_APP_ID, channelName, null, userCallingId);

  const [audioTrack, videoTrack] = await AgoraRTC.createMicrophoneAndCameraTracks(
    { AEC: true, AGC: true, ANS: true },
    { encoderConfig: { width: 640, height: 480, frameRate: 24, bitrateMin: 400, bitrateMax: 1000 } }
  );

  roomState.localAudioTrack = audioTrack;
  roomState.localVideoTrack = videoTrack;
  videoTrack.play(localContainer);
  await client.publish([audioTrack, videoTrack]);
}

export async function createAndStartRoom(hostId, hostCallingId, invitedContacts, localContainer, remoteGrid, cbs) {
  roomCbs = cbs;
  await cleanupRoomTracks();

  const roomId = `room_${hostId}_${Date.now()}`;
  const channelName = `r${roomId.replace(/[^a-zA-Z0-9]/g, '').substring(0, 18)}`;

  await setDoc(doc(db, 'rooms', roomId), {
    roomId,
    hostId,
    channelName,
    status: 'active',
    createdAt: Date.now()
  });

  roomState.activeRoomId = roomId;

  for (const contact of invitedContacts) {
    await setDoc(doc(db, 'roomInvites', `invite_${contact.uid}`), {
      roomId,
      hostId,
      channelName,
      hostName: cbs.hostName || 'Someone',
      status: 'pending',
      createdAt: Date.now()
    }).catch(() => {});
  }

  await joinChannel(channelName, hostCallingId, localContainer, remoteGrid);
  return { roomId, channelName };
}

export async function acceptRoomInvite(uid, inviteData, localContainer, remoteGrid, cbs) {
  roomCbs = cbs;
  roomState.activeRoomId = inviteData.roomId;
  await cleanupRoomTracks();

  try { await deleteDoc(doc(db, 'roomInvites', `invite_${uid}`)); } catch (_) {}

  const snap = await getDoc(doc(db, 'users', uid));
  const userData = snap.data();

  await joinChannel(inviteData.channelName, userData.callingId, localContainer, remoteGrid);
}

export async function leaveRoom(uid) {
  if (roomState.activeRoomId) {
    try { await deleteDoc(doc(db, 'roomInvites', `invite_${uid}`)); } catch (_) {}
  }
  roomState.activeRoomId = null;
  await cleanupRoomTracks();
}

export async function declineRoomInvite(uid) {
  try { await deleteDoc(doc(db, 'roomInvites', `invite_${uid}`)); } catch (_) {}
}

export function listenForRoomInvite(uid, callback) {
  const ref = doc(db, 'roomInvites', `invite_${uid}`);
  return onSnapshot(ref, (snap) => {
    if (!snap.exists()) { callback(null); return; }
    const data = snap.data();
    if (data.status === 'pending') callback(data);
    else callback(null);
  });
}
