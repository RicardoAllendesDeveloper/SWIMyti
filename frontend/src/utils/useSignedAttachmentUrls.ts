import { useEffect, useState } from 'react'
import { getSignedAttachmentUrl } from '../services/anexos'

/**
 * Signed URLs for a list of attachments, keyed by `id_anexo`.
 *
 * The `anexos` bucket is private, so a link can only be built once Storage
 * signs it. Signing per render would fire a request on every keystroke, so the
 * URLs are minted once per list and reused until the list identity changes.
 *
 * An attachment whose URL could not be signed is simply absent from the map:
 * the caller renders a disabled state rather than a link that resolves to a
 * 403.
 */
export function useSignedAttachmentUrls(
  anexos: ReadonlyArray<{ id_anexo: number; url_documento: string | null }>,
): Record<number, string> {
  const [urls, setUrls] = useState<Record<number, string>>({})

  // Key on the paths, not the array identity: callers rebuild the array on
  // every fetch, and re-signing on each fetch would be wasteful but harmless.
  // Keying on the id+path pair keeps it correct when rows actually change.
  const signature = anexos
    .map((a) => `${a.id_anexo}:${a.url_documento ?? ''}`)
    .join('|')

  useEffect(() => {
    let cancelled = false

    async function sign() {
      const entries = await Promise.all(
        anexos.map(async (a) => {
          const url = await getSignedAttachmentUrl(a.url_documento)
          return url ? ([a.id_anexo, url] as const) : null
        }),
      )

      if (cancelled) return
      const next: Record<number, string> = {}
      for (const entry of entries) {
        if (entry) next[entry[0]] = entry[1]
      }
      setUrls(next)
    }

    void sign()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  return urls
}
