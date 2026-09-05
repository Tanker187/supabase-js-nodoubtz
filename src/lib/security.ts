/**
 * Security helpers for Supabase client configuration.
 *
 * These checks are defense-in-depth. Authorization must still be enforced by
 * Supabase Auth and Postgres RLS; a client-side check is never a replacement.
 */

export const isSecureSupabaseUrl = (supabaseUrl: string): boolean => {
  try {
    const url = new URL(supabaseUrl)
    return url.protocol === 'https:' && url.hostname.length > 0
  } catch {
    return false
  }
}

export const isLocalhostUrl = (supabaseUrl: string): boolean => {
  try {
    const url = new URL(supabaseUrl)
    return (
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '[::1]' ||
      url.hostname === '::1'
    )
  } catch {
    return false
  }
}

export const assertSecureSupabaseUrl = (
  supabaseUrl: string,
  allowInsecureLocalhost = false
): void => {
  if (isSecureSupabaseUrl(supabaseUrl)) return

  if (allowInsecureLocalhost && isLocalhostUrl(supabaseUrl)) return

  throw new Error(
    'Supabase URL must use HTTPS. Insecure HTTP is only allowed for localhost when explicitly enabled.'
  )
}
