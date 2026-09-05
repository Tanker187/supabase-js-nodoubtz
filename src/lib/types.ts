import { AuthClient } from '@supabase/auth-js'
import { RealtimeClientOptions } from '@supabase/realtime-js'
import { PostgrestError } from '@supabase/postgrest-js'

type AuthClientOptions = ConstructorParameters<typeof AuthClient>[0]

export interface SupabaseAuthClientOptions extends AuthClientOptions {}

export type Fetch = typeof fetch

export type SupabaseClientOptions<SchemaName> = {
  db?: { schema?: SchemaName }
  auth?: {
    autoRefreshToken?: boolean
    storageKey?: string
    persistSession?: boolean
    detectSessionInUrl?: boolean
    storage?: SupabaseAuthClientOptions['storage']
    flowType?: SupabaseAuthClientOptions['flowType']
    debug?: SupabaseAuthClientOptions['debug']
    lock?: SupabaseAuthClientOptions['lock']
  }
  realtime?: RealtimeClientOptions
  global?: {
    fetch?: Fetch
    headers?: Record<string, string>
  }
  /** Third-party access-token provider. */
  accessToken?: () => Promise<string | null>
  /**
   * Allows plain HTTP only for localhost development. Defaults to false.
   * Never enable this for a public deployment.
   */
  allowInsecureLocalhost?: boolean
}

export type GenericRelationship = {
  foreignKeyName: string
  columns: string[]
  isOneToOne?: boolean
  referencedRelation: string
  referencedColumns: string[]
}
export type GenericTable = {
  Row: Record<string, unknown>
  Insert: Record<string, unknown>
  Update: Record<string, unknown>
  Relationships: GenericRelationship[]
}
export type GenericUpdatableView = GenericTable
export type GenericNonUpdatableView = {
  Row: Record<string, unknown>
  Relationships: GenericRelationship[]
}
export type GenericView = GenericUpdatableView | GenericNonUpdatableView
export type GenericFunction = {
  Args: Record<string, unknown>
  Returns: unknown
}
export type GenericSchema = {
  Tables: Record<string, GenericTable>
  Views: Record<string, GenericView>
  Functions: Record<string, GenericFunction>
}
export type QueryResult<T> = T extends PromiseLike<infer U> ? U : never
export type QueryData<T> = T extends PromiseLike<{ data: infer U }> ? Exclude<U, null> : never
export type QueryError = PostgrestError
