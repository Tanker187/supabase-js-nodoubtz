import { FunctionsClient } from '@supabase/functions-js'
import { AuthChangeEvent } from '@supabase/auth-js'
import { PostgrestClient, PostgrestFilterBuilder, PostgrestQueryBuilder } from '@supabase/postgrest-js'
import { RealtimeChannel, RealtimeChannelOptions, RealtimeClient, RealtimeClientOptions } from '@supabase/realtime-js'
import { StorageClient as SupabaseStorageClient } from '@supabase/storage-js'
import { DEFAULT_GLOBAL_OPTIONS, DEFAULT_DB_OPTIONS, DEFAULT_AUTH_OPTIONS, DEFAULT_REALTIME_OPTIONS } from './lib/constants'
import { fetchWithAuth } from './lib/fetch'
import { ensureTrailingSlash, applySettingDefaults } from './lib/helpers'
import { SupabaseAuthClient } from './lib/SupabaseAuthClient'
import { assertSecureSupabaseUrl } from './lib/security'
import { Fetch, GenericSchema, SupabaseClientOptions, SupabaseAuthClientOptions } from './lib/types'

export default class SupabaseClient<
  Database = any,
  SchemaName extends string & keyof Database = 'public' extends keyof Database ? 'public' : string & keyof Database,
  Schema extends GenericSchema = Database[SchemaName] extends GenericSchema ? Database[SchemaName] : any
> {
  auth: SupabaseAuthClient
  realtime: RealtimeClient
  protected realtimeUrl: URL
  protected authUrl: URL
  protected storageUrl: URL
  protected functionsUrl: URL
  protected rest: PostgrestClient<Database, SchemaName, Schema>
  protected storageKey: string
  protected fetch?: Fetch
  protected changedAccessToken?: string
  protected accessToken?: () => Promise<string | null>
  protected headers: Record<string, string>

  constructor(protected supabaseUrl: string, protected supabaseKey: string, options?: SupabaseClientOptions<SchemaName>) {
    if (!supabaseUrl) throw new Error('supabaseUrl is required.')
    if (!supabaseKey) throw new Error('supabaseKey is required.')
    assertSecureSupabaseUrl(supabaseUrl, options?.allowInsecureLocalhost ?? false)

    const baseUrl = new URL(ensureTrailingSlash(supabaseUrl))
    this.realtimeUrl = new URL('realtime/v1', baseUrl)
    this.realtimeUrl.protocol = this.realtimeUrl.protocol.replace('http', 'ws')
    this.authUrl = new URL('auth/v1', baseUrl)
    this.storageUrl = new URL('storage/v1', baseUrl)
    this.functionsUrl = new URL('functions/v1', baseUrl)

    const defaultStorageKey = `sb-${baseUrl.hostname.split('.')[0]}-auth-token`
    const DEFAULTS = {
      db: DEFAULT_DB_OPTIONS,
      realtime: DEFAULT_REALTIME_OPTIONS,
      auth: { ...DEFAULT_AUTH_OPTIONS, storageKey: defaultStorageKey },
      global: DEFAULT_GLOBAL_OPTIONS,
    }
    const settings = applySettingDefaults(options ?? {}, DEFAULTS)
    this.storageKey = settings.auth.storageKey ?? ''
    this.headers = settings.global.headers ?? {}

    if (!settings.accessToken) {
      this.auth = this._initSupabaseAuthClient(settings.auth ?? {}, this.headers, settings.global.fetch)
    } else {
      this.accessToken = settings.accessToken
      this.auth = new Proxy<SupabaseAuthClient>({} as any, {
        get: (_, prop) => {
          throw new Error(`@supabase/supabase-js: Supabase Client is configured with the accessToken option, accessing supabase.auth.${String(prop)} is not possible`)
        },
      })
    }

    this.fetch = fetchWithAuth(supabaseKey, this._getAccessToken.bind(this), settings.global.fetch)
    this.realtime = this._initRealtimeClient({ headers: this.headers, accessToken: this._getAccessToken.bind(this), ...settings.realtime })
    this.rest = new PostgrestClient(new URL('rest/v1', baseUrl).href, {
      headers: this.headers,
      schema: settings.db.schema,
      fetch: this.fetch,
    })
    if (!settings.accessToken) this._listenForAuthEvents()
  }

  get functions(): FunctionsClient {
    return new FunctionsClient(this.functionsUrl.href, { headers: this.headers, customFetch: this.fetch })
  }
  get storage(): SupabaseStorageClient {
    return new SupabaseStorageClient(this.storageUrl.href, this.headers, this.fetch)
  }
  from<TableName extends string & keyof Schema['Tables'], Table extends Schema['Tables'][TableName]>(relation: TableName): PostgrestQueryBuilder<Schema, Table, TableName>
  from<ViewName extends string & keyof Schema['Views'], View extends Schema['Views'][ViewName]>(relation: ViewName): PostgrestQueryBuilder<Schema, View, ViewName>
  from(relation: string): PostgrestQueryBuilder<Schema, any, any> { return this.rest.from(relation) }
  schema<DynamicSchema extends string & keyof Database>(schema: DynamicSchema): PostgrestClient<Database, DynamicSchema, Database[DynamicSchema] extends GenericSchema ? Database[DynamicSchema] : any> { return this.rest.schema<DynamicSchema>() }
  rpc<FnName extends string & keyof Schema['Functions'], Fn extends Schema['Functions'][FnName]>(fn: FnName, args: Fn['Args'] = {}, options: { head?: boolean; get?: boolean; count?: 'exact' | 'planned' | 'estimated' } = {}): PostgrestFilterBuilder<Schema, Fn['Returns'] extends any[] ? Fn['Returns'][number] extends Record<string, unknown> ? Fn['Returns'][number] : never : never, Fn['Returns'], FnName, null> { return this.rest.rpc(fn, args, options) }
  channel(name: string, opts: RealtimeChannelOptions = { config: {} }): RealtimeChannel { return this.realtime.channel(name, opts) }
  getChannels(): RealtimeChannel[] { return this.realtime.getChannels() }
  removeChannel(channel: RealtimeChannel): Promise<'ok' | 'timed out' | 'error'> { return this.realtime.removeChannel(channel) }
  removeAllChannels(): Promise<('ok' | 'timed out' | 'error')[]> { return this.realtime.removeAllChannels() }

  private async _getAccessToken() {
    if (this.accessToken) return await this.accessToken()
    const { data } = await this.auth.getSession()
    return data.session?.access_token ?? null
  }
  private _initSupabaseAuthClient({ autoRefreshToken, persistSession, detectSessionInUrl, storage, storageKey, flowType, lock, debug }: SupabaseAuthClientOptions, headers?: Record<string, string>, fetch?: Fetch) {
    const authHeaders = { Authorization: `Bearer ${this.supabaseKey}`, apikey: `${this.supabaseKey}` }
    return new SupabaseAuthClient({ url: this.authUrl.href, headers: { ...authHeaders, ...headers }, storageKey, autoRefreshToken, persistSession, detectSessionInUrl, storage, flowType, lock, debug, fetch, hasCustomAuthorizationHeader: 'Authorization' in this.headers })
  }
  private _initRealtimeClient(options: RealtimeClientOptions) {
    return new RealtimeClient(this.realtimeUrl.href, { ...options, params: { ...{ apikey: this.supabaseKey }, ...options?.params } })
  }
  private _listenForAuthEvents() { return this.auth.onAuthStateChange((event, session) => this._handleTokenChanged(event, 'CLIENT', session?.access_token)) }
  private _handleTokenChanged(event: AuthChangeEvent, source: 'CLIENT' | 'STORAGE', token?: string) {
    if ((event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') && this.changedAccessToken !== token) this.changedAccessToken = token
    else if (event === 'SIGNED_OUT') {
      this.realtime.setAuth()
      if (source === 'STORAGE') this.auth.signOut()
      this.changedAccessToken = undefined
    }
  }
}
