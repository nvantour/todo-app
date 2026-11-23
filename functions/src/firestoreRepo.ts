import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore'
import type { CalendarRule, Project, Reply, Suggestion, Todo } from '../../src/model/types'
import type { AuthCode, GoogleConnection, GoogleState, OAuthClient, PushDevice, Repo, ServerState, TokenRecord } from './repo'

/** Firestore weigert `undefined`; dit haalt die eruit. */
const clean = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

const ttl = (iso: string | null | undefined) => (iso ? { expireAt: Timestamp.fromDate(new Date(iso)) } : {})

export class FirestoreRepo implements Repo {
  constructor(private db: Firestore = getFirestore()) {}

  private col(uid: string, name: string) {
    return this.db.collection('users').doc(uid).collection(name)
  }

  async listTodos(uid: string) {
    return (await this.col(uid, 'todos').get()).docs.map((d) => d.data() as Todo)
  }
  async getTodo(uid: string, id: string) {
    const d = await this.col(uid, 'todos').doc(id).get()
    return d.exists ? (d.data() as Todo) : null
  }
  async saveTodo(uid: string, todo: Todo) {
    await this.col(uid, 'todos').doc(todo.id).set(clean(todo))
  }
  async listProjects(uid: string) {
    return (await this.col(uid, 'projects').get()).docs.map((d) => d.data() as Project)
  }
  async listTodosDueOn(uid: string, day: string) {
    const snap = await this.col(uid, 'todos').where('due', '==', day).get()
    return snap.docs.map((d) => d.data() as Todo).filter((t) => !t.done)
  }
  async listCalendarRules(uid: string) {
    return (await this.col(uid, 'calendarRules').get()).docs.map((d) => ({ ...(d.data() as Omit<CalendarRule, 'id'>), id: d.id }))
  }
  async saveCalendarRule(uid: string, rule: CalendarRule) {
    await this.col(uid, 'calendarRules').doc(rule.id).set(clean(rule))
  }

  // Alles hieronder staat in verzamelingen op het hoogste niveau; de regels in firestore.rules sluiten ze voor de app af.
  async getGoogle(uid: string) {
    const d = await this.db.collection('googleConnections').doc(uid).get()
    return d.exists ? (d.data() as GoogleConnection) : null
  }
  async listGoogle() {
    return (await this.db.collection('googleConnections').get()).docs.map((d) => d.data() as GoogleConnection)
  }
  async saveGoogle(conn: GoogleConnection) {
    await this.db.collection('googleConnections').doc(conn.uid).set(clean(conn))
  }
  async deleteGoogle(uid: string) {
    await this.db.collection('googleConnections').doc(uid).delete()
  }
  async saveGoogleState(state: GoogleState) {
    await this.db.collection('googleStates').doc(state.hash).set({ ...clean(state), ...ttl(state.expiresAt) })
  }
  async consumeGoogleState(hash: string) {
    const ref = this.db.collection('googleStates').doc(hash)
    return this.db.runTransaction(async (tx) => {
      const d = await tx.get(ref)
      if (!d.exists) return null
      tx.delete(ref)
      return d.data() as GoogleState
    })
  }

  async listDevices(uid: string) {
    return (await this.db.collection('pushDevices').where('uid', '==', uid).get()).docs.map((d) => d.data() as PushDevice)
  }
  async listAllDevices() {
    return (await this.db.collection('pushDevices').get()).docs.map((d) => d.data() as PushDevice)
  }
  async saveDevice(device: PushDevice) {
    await this.db.collection('pushDevices').doc(device.id).set(clean(device))
  }
  async deleteDevice(id: string) {
    await this.db.collection('pushDevices').doc(id).delete()
  }

  async getState(uid: string) {
    const d = await this.db.collection('serverState').doc(uid).get()
    return d.exists ? (d.data() as ServerState) : {}
  }
  async saveState(uid: string, patch: Partial<ServerState>) {
    // Hele document terugschrijven (geen merge), zodat verwijderde sleutels in `notified` ook echt weg zijn.
    const ref = this.db.collection('serverState').doc(uid)
    await this.db.runTransaction(async (tx) => {
      const d = await tx.get(ref)
      tx.set(ref, clean({ ...(d.exists ? (d.data() as ServerState) : {}), ...patch }))
    })
  }

  async listReplies(uid: string) {
    return (await this.col(uid, 'replies').get()).docs.map((d) => ({ ...(d.data() as Reply), id: d.id }))
  }
  async getReply(uid: string, id: string) {
    const d = await this.col(uid, 'replies').doc(id).get()
    return d.exists ? ({ ...(d.data() as Reply), id: d.id }) : null
  }
  async saveReply(uid: string, reply: Reply) {
    await this.col(uid, 'replies').doc(reply.id).set(clean(reply))
  }

  async listSuggestions(uid: string) {
    return (await this.col(uid, 'suggestions').get()).docs.map((d) => d.data() as Suggestion)
  }
  async saveSuggestion(uid: string, s: Suggestion) {
    await this.col(uid, 'suggestions').doc(s.id).set(clean(s))
  }

  private tokens() {
    return this.db.collection('apiTokens')
  }
  async findToken(hash: string) {
    const d = await this.tokens().doc(hash).get()
    return d.exists ? (d.data() as TokenRecord) : null
  }
  async saveToken(r: TokenRecord) {
    await this.tokens().doc(r.hash).set({ ...clean(r), ...(r.kind === 'personal' ? {} : ttl(r.expiresAt)) })
  }
  async touchToken(hash: string, at: string) {
    await this.tokens().doc(hash).update({ lastUsedAt: at })
  }
  async listTokens(uid: string) {
    return (await this.tokens().where('uid', '==', uid).get()).docs.map((d) => d.data() as TokenRecord)
  }
  async deleteToken(uid: string, id: string) {
    const snap = await this.tokens().where('uid', '==', uid).where('id', '==', id).get()
    await Promise.all(snap.docs.map((d) => d.ref.delete()))
    return !snap.empty
  }
  async deleteTokenByHash(hash: string) {
    await this.tokens().doc(hash).delete()
  }

  async getClient(id: string) {
    const d = await this.db.collection('oauthClients').doc(id).get()
    return d.exists ? (d.data() as OAuthClient) : null
  }
  async saveClient(c: OAuthClient) {
    await this.db.collection('oauthClients').doc(c.id).set({ ...clean(c), ...ttl(c.expiresAt) })
  }
  async saveCode(c: AuthCode) {
    await this.db.collection('oauthCodes').doc(c.hash).set({ ...clean(c), ...ttl(c.expiresAt) })
  }
  async consumeCode(hash: string) {
    const ref = this.db.collection('oauthCodes').doc(hash)
    return this.db.runTransaction(async (tx) => {
      const d = await tx.get(ref)
      if (!d.exists) return null
      tx.delete(ref)
      return d.data() as AuthCode
    })
  }
}
