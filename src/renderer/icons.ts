// Tabler Icons (MIT, https://tabler.io/icons), inlined at build time as raw SVG
// so they work offline and travel with their element into a float window.
// They draw in currentColor, so the .active / .active-dim accents still apply.
import plus from '@tabler/icons/outline/plus.svg?raw'
import x from '@tabler/icons/outline/x.svg?raw'
import chevronRight from '@tabler/icons/outline/chevron-right.svg?raw'
import chevronLeft from '@tabler/icons/outline/chevron-left.svg?raw'
import play from '@tabler/icons/filled/player-play.svg?raw'
import pause from '@tabler/icons/filled/player-pause.svg?raw'
import back10 from '@tabler/icons/outline/rewind-backward-10.svg?raw'
import fwd10 from '@tabler/icons/outline/rewind-forward-10.svg?raw'
import volume from '@tabler/icons/outline/volume.svg?raw'
import volumeOff from '@tabler/icons/outline/volume-off.svg?raw'
import maximize from '@tabler/icons/outline/maximize.svg?raw'
import minimize from '@tabler/icons/outline/minimize.svg?raw'
import pip from '@tabler/icons/outline/picture-in-picture.svg?raw'
import cycle from '@tabler/icons/outline/arrow-big-right-lines.svg?raw'
import arrowsMaximize from '@tabler/icons/outline/arrows-maximize.svg?raw'
import arrowsMinimize from '@tabler/icons/outline/arrows-minimize.svg?raw'

const SVGS = {
  plus,
  x,
  'chevron-right': chevronRight,
  'chevron-left': chevronLeft,
  play,
  pause,
  'back-10': back10,
  'fwd-10': fwd10,
  volume,
  'volume-off': volumeOff,
  maximize,
  minimize,
  pip,
  cycle,
  'arrows-maximize': arrowsMaximize,
  'arrows-minimize': arrowsMinimize
}

export type IconName = keyof typeof SVGS

export function isIconName(name: string): name is IconName {
  return name in SVGS
}

/**
 * Replaces el's content with the named icon and records the name in
 * data-icon (which is also what tests assert on, since there is no text).
 */
export function setIcon(el: HTMLElement, name: IconName): void {
  if (el.dataset.icon === name && el.firstElementChild) return
  el.dataset.icon = name
  el.innerHTML = SVGS[name]
  const svg = el.firstElementChild as SVGElement
  svg.setAttribute('aria-hidden', 'true')
  svg.removeAttribute('width')
  svg.removeAttribute('height')
}

/** Fills every element that declares data-icon in the static markup. */
export function hydrateIcons(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-icon]')) {
    const name = el.dataset.icon!
    if (isIconName(name)) setIcon(el, name)
  }
}
