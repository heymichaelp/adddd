import type { AddddSquirrel } from '../types'

/**
 * Off-screen squirrels: nothing is waiting on you, so go be a person for a minute.
 * Each nudge is short enough to finish before a worker comes back.
 */
export type Nudge = { slug: string; title: string; why: string; when?: 'morning' | 'day' | 'evening' | 'late' }

export const NUDGES: readonly Nudge[] = [
  { slug: 'text-mom', title: 'text your mom', why: 'she would like that. the workers will not notice.' },
  { slug: 'snack', title: 'get a snack, but hurry', why: 'something you do not have to cook. back before the next card.' },
  { slug: 'water', title: 'refill your water', why: 'the glass is empty. it has been empty for a while.' },
  { slug: 'stretch', title: 'stand up and stretch for thirty seconds', why: 'shoulders down from your ears. the worktrees can wait.' },
  { slug: 'window', title: 'look at something far away for twenty seconds', why: 'out a window, past the screen. your eyes have been at arm\'s length all day.' },
  { slug: 'outside', title: 'step outside and get some light on your face', why: 'one minute. no phone. the build is still building.' },
  { slug: 'pushups', title: 'do ten push-ups', why: 'or squats. nobody is watching and nothing is blocked on you.' },
  { slug: 'dish', title: 'put one dish in the dishwasher', why: 'just one. momentum is a lie you can tell yourself.' },
  { slug: 'hi', title: 'say hi to whoever is in the house', why: 'or the dog. or the plant. out loud.' },
  { slug: 'pet', title: 'feed the pet or water the plant', why: 'one of them is looking at you.' },
  { slug: 'floor', title: 'lie on the floor for two minutes', why: 'set a timer. stare at the ceiling. this is allowed.' },
  { slug: 'mailbox', title: 'walk to the mailbox', why: 'or the end of the hall and back. legs exist.' },
  { slug: 'writeit', title: 'write down the thing you keep meaning to remember', why: 'the one that popped up twice already today. paper is fine.' },
  { slug: 'book-it', title: 'book the appointment you have been putting off', why: 'dentist, haircut, oil change. two minutes online, then it is gone from your head.' },
  { slug: 'meds', title: 'take your meds if you have some', why: 'you know the ones. this card is the reminder.' },
  { slug: 'tabs', title: 'close the browser tabs you are not using', why: 'browser tabs, not worktrees. the worktrees are fine.' },
  { slug: 'reply', title: 'reply to the one text you have been ignoring', why: 'one line is enough. "sorry, swamped, yes" counts.' },
  { slug: 'breathe', title: 'four slow breaths, in through the nose', why: 'nothing needs you for the next twenty seconds. prove it.' },
  { slug: 'desk', title: 'clear one thing off your desk', why: 'the mug. the cable. the receipt from a month ago.' },
  { slug: 'teeth', title: 'go brush your teeth', why: 'it has been a while, has it not.', when: 'late' },
  { slug: 'coffee', title: 'make a proper coffee or tea', why: 'the kettle takes exactly as long as a worker does.', when: 'morning' },
  { slug: 'breakfast', title: 'eat something that is not coffee', why: 'toast counts. a banana counts.', when: 'morning' },
  { slug: 'lunch', title: 'eat an actual lunch', why: 'away from the keyboard. the cards will queue up politely.', when: 'day' },
  { slug: 'dinner', title: 'figure out what dinner is', why: 'deciding now beats deciding at nine.', when: 'evening' },
  { slug: 'wind-down', title: 'dim the lights a bit', why: 'your eyes and your sleep will both thank you.', when: 'evening' },
  { slug: 'stop', title: 'ask yourself if you should stop for today', why: 'the workers keep going without you. that is the whole point.', when: 'late' },
]

export function timeOfDay(hour: number): NonNullable<Nudge['when']> {
  if (hour >= 5 && hour < 11) return 'morning'
  if (hour >= 11 && hour < 17) return 'day'
  if (hour >= 17 && hour < 22) return 'evening'
  return 'late'
}

/** Picks a nudge the operator has not seen lately, preferring ones that fit the hour. */
export function pickNudge(
  seen: ReadonlySet<string>,
  hour: number,
  rand: () => number = Math.random,
  banned: ReadonlySet<string> = new Set(),
): Nudge | undefined {
  const slot = timeOfDay(hour)
  const allowed = NUDGES.filter(n => !banned.has(`life:${n.slug}`))
  const fits = allowed.filter(n => !n.when || n.when === slot)
  const fresh = fits.filter(n => !seen.has(`life:${n.slug}`))
  const pool = fresh.length > 0 ? fresh : fits.length > 0 ? fits : allowed
  return pool[Math.floor(rand() * pool.length)]
}
/** Seen is soft (least-recently shown wins); banned is hard (never returned). */

export function makeLifeSquirrel(n: Nudge, now: number, busy: number): AddddSquirrel {
  const blurb = busy > 0 ? `${busy} worker${busy === 1 ? ' is' : 's are'} busy. you are not.` : 'nothing is waiting on you.'
  return { id: `life:${n.slug}`, title: n.title, url: '', blurb, source: 'life', topic: 'off-screen', why: n.why, foundAt: now }
}

export const isLife = (s: AddddSquirrel | null | undefined): boolean => s?.source === 'life'
