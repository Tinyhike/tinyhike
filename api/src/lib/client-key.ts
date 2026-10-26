import { isIP } from 'node:net'

/**
 * Rate-limit key for a client address.
 *
 * IPv4 is used as-is. IPv6 is cut down to its /64: a home connection or a VPS
 * routinely gets a whole /64 (2^64 addresses), so keying on the full address
 * lets one machine rotate past every per-IP limit in the app — magic links,
 * reviews, uploads. One /64 is the standard granularity for IPv6 abuse limits.
 *
 * `ip` is request.ip, i.e. the visitor address nginx resolved from
 * CF-Connecting-IP (see trustProxy in app.ts).
 */
export function clientKey(ip: string): string {
  const family = isIP(ip.split('%')[0])
  if (family !== 6) return ip

  const hextets = expandIPv6(ip)
  // IPv4-mapped (::ffff:a.b.c.d) is really an IPv4 client.
  if (hextets.slice(0, 5).every((h) => h === '0') && hextets[5] === 'ffff') {
    const [hi, lo] = [parseInt(hextets[6], 16), parseInt(hextets[7], 16)]
    return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join('.')
  }
  return `${hextets.slice(0, 4).join(':')}::/64`
}

/** Eight canonical hextets (lowercase, no leading zeros) from any valid IPv6 text form. */
function expandIPv6(ip: string): string[] {
  let addr = ip.split('%')[0].toLowerCase()

  // An embedded IPv4 tail (e.g. 64:ff9b::192.0.2.1) is two hextets in disguise.
  const v4 = addr.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number)
    addr = `${addr.slice(0, -v4[0].length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }

  const [headPart, tailPart] = addr.split('::')
  const head = headPart ? headPart.split(':') : []
  const tail = tailPart ? tailPart.split(':') : []
  const zeros = tailPart === undefined ? [] : Array<string>(8 - head.length - tail.length).fill('0')
  return [...head, ...zeros, ...tail].map((h) => parseInt(h, 16).toString(16))
}
