import { useState } from 'react'
import { api } from '../lib/api.js'
import { useI18n, type MessageKey } from '../lib/i18n.js'
import { TAGS, allTags, collapsedTags, groupOrder, unknownCount, type PlaceTags, type TagDef, type TagKey, type TagGroup } from '../lib/tags.js'

/**
 * "What this place offers" — the Airbnb-style amenities section from the mockup
 * Jerome validated (design/mockups/place-tags-mockup.html).
 *
 * Three states, and the third is the point: yes (mint chip), no (struck through,
 * like Airbnb's unavailable amenities), unknown (dashed icon + a "Confirm" chip
 * that opens a yes/no vote). Unknown is the dominant state of the dataset, so it
 * is drawn as the invitation to contribute, not as missing data.
 *
 * Votes post to the anonymous reviews endpoint as tagsConfirmed/tagsDisputed —
 * they accrue as evidence; flipping the Place boolean itself stays a moderation
 * decision (see ROADMAP).
 */
export default function PlaceAmenities({ placeId, place }: { placeId: string; place: PlaceTags }) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(false)
  // Session-local record of this visitor's votes: instant feedback, no re-vote UI.
  const [voted, setVoted] = useState<Partial<Record<TagKey, boolean>>>({})
  const [openTag, setOpenTag] = useState<TagKey | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const rows = expanded ? allTags(place) : collapsedTags(place)
  const order = groupOrder(place)
  const unknowns = unknownCount(place)

  async function vote(tag: TagKey, present: boolean) {
    setOpenTag(null)
    // Optimistic: show the vote immediately; roll back if the API refuses.
    setVoted((v) => ({ ...v, [tag]: present }))
    try {
      await api.post(`/api/places/${placeId}/reviews`, {
        [present ? 'tagsConfirmed' : 'tagsDisputed']: [tag],
        anonymous: true,
      })
      showToast(t('amen.voteThanks'))
    } catch {
      setVoted((v) => {
        const { [tag]: _dropped, ...rest } = v
        return rest
      })
      showToast(t('amen.voteError'))
    }
  }

  function showToast(message: string) {
    setToast(message)
    window.setTimeout(() => setToast(null), 2600)
  }

  // Group the visible rows, keeping the kind-appropriate group order.
  const byGroup = new Map<TagGroup, TagDef[]>()
  for (const row of rows) {
    const list = byGroup.get(row.group) ?? []
    list.push(row)
    byGroup.set(row.group, list)
  }

  return (
    <section className="amen">
      <h2>{t('amen.title')}</h2>
      {unknowns > 0 && (
        <p className="amen-sub">{t('amen.toConfirm').replace('{n}', String(unknowns))}</p>
      )}

      {order
        .filter((group) => byGroup.has(group))
        .map((group) => (
          <div className="amen-group" key={group}>
            <h3 className="amen-group-title">{t(`tagGroup.${group}` as MessageKey)}</h3>
            <div className="amen-rows">
              {byGroup.get(group)!.map((def) => (
                <AmenRow
                  key={def.key}
                  def={def}
                  // A fresh vote renders as if the value were known — the reward
                  // for contributing is seeing the card improve immediately.
                  value={voted[def.key] ?? place[def.key] ?? null}
                  justVoted={def.key in voted}
                  open={openTag === def.key}
                  onOpen={() => setOpenTag(openTag === def.key ? null : def.key)}
                  onVote={(present) => vote(def.key, present)}
                  onCancel={() => setOpenTag(null)}
                />
              ))}
            </div>
          </div>
        ))}

      <button className="amen-more" onClick={() => setExpanded((e) => !e)}>
        {expanded ? t('amen.showLess') : t('amen.showAll').replace('{n}', String(TAGS.length))}
      </button>

      {toast && (
        <div className="amen-toast" role="status">
          {toast}
        </div>
      )}
    </section>
  )
}

function AmenRow({
  def,
  value,
  justVoted,
  open,
  onOpen,
  onVote,
  onCancel,
}: {
  def: TagDef
  value: boolean | null
  justVoted: boolean
  open: boolean
  onOpen: () => void
  onVote: (present: boolean) => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  const label = t(`tag.${def.key}` as MessageKey)

  if (value === true) {
    return (
      <div className="amen-row amen-row--yes">
        <span className="amen-ico" aria-hidden="true">{def.emoji}</span>
        <span>{label}</span>
        {justVoted && <span className="amen-voted" aria-hidden="true">✓</span>}
      </div>
    )
  }

  if (value === false) {
    return (
      <div className="amen-row amen-row--no">
        <span className="amen-ico" aria-hidden="true">{def.emoji}</span>
        <span className="amen-strike">{label}</span>
        {justVoted && <span className="amen-voted" aria-hidden="true">✓</span>}
      </div>
    )
  }

  // Unknown: the row itself is the button that opens the vote.
  return (
    <div className="amen-unk-wrap">
      <button className="amen-row amen-row--unk" onClick={onOpen} aria-expanded={open}>
        <span className="amen-ico" aria-hidden="true">?</span>
        <span>
          {label}
          <span className="amen-chip">{t('amen.confirmChip')}</span>
        </span>
      </button>
      {open && (
        <div className="amen-vote" role="group" aria-label={`${label} — ${t('amen.votePrompt')}`}>
          <span className="amen-vote-q">{t('amen.votePrompt')}</span>
          <button className="amen-vote-btn amen-vote-btn--yes" onClick={() => onVote(true)}>
            {t('amen.voteYes')}
          </button>
          <button className="amen-vote-btn amen-vote-btn--no" onClick={() => onVote(false)}>
            {t('amen.voteNo')}
          </button>
          <button className="amen-vote-btn" onClick={onCancel}>
            {t('amen.voteCancel')}
          </button>
        </div>
      )}
    </div>
  )
}
