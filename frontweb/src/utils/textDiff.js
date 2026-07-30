const MAX_TOKENS = 6000
const MAX_PRODUCT = 2000000

export function tokenizeText(text) {
  return String(text ?? '').match(/[\p{Script=Han}]|[A-Za-z0-9]+|\s|[^\s]/gu) || []
}

function appendPart(parts, type, text) {
  if (!text) return
  const last = parts[parts.length - 1]
  if (last?.type === type) last.text += text
  else parts.push({ type, text })
}

function fallback(oldText, newText) {
  const parts = []
  appendPart(parts, 'remove', String(oldText ?? ''))
  appendPart(parts, 'add', String(newText ?? ''))
  return parts
}

export function diffText(oldText, newText) {
  const oldTokens = tokenizeText(oldText)
  const newTokens = tokenizeText(newText)
  const rows = oldTokens.length
  const columns = newTokens.length
  if (rows > MAX_TOKENS || columns > MAX_TOKENS || rows * columns > MAX_PRODUCT) {
    return fallback(oldText, newText)
  }

  const directions = new Uint8Array(rows * columns)
  let previous = new Uint16Array(columns + 1)
  let current = new Uint16Array(columns + 1)
  for (let row = 1; row <= rows; row += 1) {
    current[0] = 0
    for (let column = 1; column <= columns; column += 1) {
      const index = (row - 1) * columns + column - 1
      if (oldTokens[row - 1] === newTokens[column - 1]) {
        current[column] = previous[column - 1] + 1
        directions[index] = 0
      } else if (previous[column] >= current[column - 1]) {
        current[column] = previous[column]
        directions[index] = 1
      } else {
        current[column] = current[column - 1]
        directions[index] = 2
      }
    }
    const swap = previous
    previous = current
    current = swap
  }

  const reversed = []
  let row = rows
  let column = columns
  while (row > 0 || column > 0) {
    if (row === 0) {
      reversed.push({ type: 'add', text: newTokens[column - 1] })
      column -= 1
      continue
    }
    if (column === 0) {
      reversed.push({ type: 'remove', text: oldTokens[row - 1] })
      row -= 1
      continue
    }
    const direction = directions[(row - 1) * columns + column - 1]
    if (direction === 0 && oldTokens[row - 1] === newTokens[column - 1]) {
      reversed.push({ type: 'same', text: oldTokens[row - 1] })
      row -= 1
      column -= 1
    } else if (direction === 1) {
      reversed.push({ type: 'remove', text: oldTokens[row - 1] })
      row -= 1
    } else {
      reversed.push({ type: 'add', text: newTokens[column - 1] })
      column -= 1
    }
  }

  const parts = []
  for (const part of reversed.reverse()) appendPart(parts, part.type, part.text)
  return parts
}
