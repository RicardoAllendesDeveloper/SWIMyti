import { supabase } from './supabase'

/**
 * Signed access to clinical attachments.
 *
 * The `anexos` bucket is private: every object is a patient's document, and a
 * public bucket hands out a guessable URL that answers without a session. Under
 * Ley 19.628 that is not acceptable, so reads go through a short-lived signed
 * URL instead.
 *
 * `anexos_clinicos.url_documento` stores the OBJECT PATH, not a URL. It used to
 * store `getPublicUrl()` output, which only worked because the bucket was
 * public; a signed URL stored there would expire in minutes and leave the row
 * unusable. Paths are stable, so the URL is minted at the moment of display.
 */

const BUCKET = 'anexos'

/** Five minutes: long enough to open the file, short enough not to be a leak. */
const SIGNED_URL_TTL_SECONDS = 300

/**
 * Derive the object path from whatever is stored in `url_documento`.
 *
 * Rows written before the bucket went private hold a full public URL. Accepting
 * both keeps old rows readable without a data migration, and the migration to
 * paths-only is a separate concern.
 */
export function toObjectPath(stored: string | null | undefined): string | null {
  if (!stored) return null
  const value = stored.trim()
  if (!value) return null

  // Already a path: "<patientId>/<timestamp>_<file>".
  if (!value.includes('://')) {
    return value.replace(/^\/+/, '')
  }

  // A full URL: take everything after "/storage/v1/object/<bucket>/".
  const marker = `/object/${BUCKET}/`
  const index = value.lastIndexOf(marker)
  if (index === -1) return null

  return decodeURIComponent(value.slice(index + marker.length)).replace(/^\/+/, '')
}

/**
 * Mint a signed URL for one attachment. Returns null when the row has no usable
 * path or Storage refuses, so the caller can render a disabled state instead of
 * a link that 403s.
 */
export async function getSignedAttachmentUrl(
  stored: string | null | undefined,
): Promise<string | null> {
  const path = toObjectPath(stored)
  if (!path) return null

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)

  if (error || !data?.signedUrl) return null
  return data.signedUrl
}
