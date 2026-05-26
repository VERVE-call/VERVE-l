import {
  doc, setDoc, deleteDoc, collection, onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from './firebase.js';

export async function saveContact(myUid, contact) {
  const ref = doc(db, 'users', myUid, 'contacts', contact.uid);
  await setDoc(ref, {
    uid: contact.uid,
    callingId: contact.callingId,
    displayName: contact.displayName,
    savedAt: Date.now()
  });
}

export async function removeContact(myUid, contactUid) {
  await deleteDoc(doc(db, 'users', myUid, 'contacts', contactUid));
}

export function listenContacts(myUid, callback) {
  const ref = collection(db, 'users', myUid, 'contacts');
  return onSnapshot(ref, (snap) => {
    const contacts = [];
    snap.forEach(d => contacts.push(d.data()));
    contacts.sort((a, b) => a.displayName.localeCompare(b.displayName));
    callback(contacts);
  });
}
