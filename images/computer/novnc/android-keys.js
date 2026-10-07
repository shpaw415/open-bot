export const PAD = "\uE000"
export const PAD_CODE = 0xe000
export const XK_UNDERSCORE = 0x5f

export function padding(len) {
  return PAD.repeat(Math.max(0, len - 1))
}

export function stripPad(value) {
  return value.replaceAll(PAD, "")
}

export function isAndroid(ua = "") {
  return /Android/i.test(ua)
}

export function ignoreAndroidUnderscore(keysym, ua = "") {
  return isAndroid(ua) && keysym === XK_UNDERSCORE
}

export function diffTyped(prev, next) {
  const before = [...prev]
  const after = [...next]
  let index = 0
  while (
    index < before.length &&
    index < after.length &&
    before[index] === after[index]
  ) {
    index += 1
  }
  return {
    backspaces: before.length - index,
    insert: after.slice(index).join(""),
  }
}

export function androidActions(prevTyped, rawValue, maxLen = 200) {
  const visible = stripPad(rawValue)
  const { backspaces, insert } = diffTyped(prevTyped, visible)
  let typed = visible
  if (typed.length > maxLen) {
    typed = typed.slice(typed.length - Math.floor(maxLen / 2))
  }
  return { typed, backspaces, insert }
}
