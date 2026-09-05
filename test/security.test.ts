import {
  assertSecureSupabaseUrl,
  isLocalhostUrl,
  isSecureSupabaseUrl,
} from '../src/lib/security'

describe('Supabase URL security', () => {
  test('accepts HTTPS URLs', () => {
    expect(isSecureSupabaseUrl('https://example.supabase.co')).toBe(true)
    expect(() => assertSecureSupabaseUrl('https://example.supabase.co')).not.toThrow()
  })

  test('rejects malformed URLs', () => {
    expect(isSecureSupabaseUrl('not-a-url')).toBe(false)
    expect(() => assertSecureSupabaseUrl('not-a-url')).toThrow()
  })

  test('rejects insecure public HTTP URLs', () => {
    expect(isSecureSupabaseUrl('http://example.supabase.co')).toBe(false)
    expect(() => assertSecureSupabaseUrl('http://example.supabase.co')).toThrow()
  })

  test('allows HTTP localhost only when explicitly enabled', () => {
    expect(isLocalhostUrl('http://localhost:54321')).toBe(true)
    expect(() => assertSecureSupabaseUrl('http://localhost:54321')).toThrow()
    expect(() => assertSecureSupabaseUrl('http://localhost:54321', true)).not.toThrow()
    expect(() => assertSecureSupabaseUrl('http://127.0.0.1:54321', true)).not.toThrow()
    expect(() => assertSecureSupabaseUrl('http://[::1]:54321', true)).not.toThrow()
  })

  test('accepts HTTPS localhost without the development exception', () => {
    expect(() => assertSecureSupabaseUrl('https://localhost:54321')).not.toThrow()
  })
})
