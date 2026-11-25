export function parseRoomsCsv(text) {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/)
  const rows = []

  function parseLine(line) {
    const values = []
    let value = ''
    let quoted = false
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index]
      if (character === '"' && line[index + 1] === '"') {
        value += '"'
        index += 1
      } else if (character === '"') {
        quoted = !quoted
      } else if (character === ',' && !quoted) {
        values.push(value.trim())
        value = ''
      } else {
        value += character
      }
    }
    values.push(value.trim())
    return values
  }

  let headerFound = false
  let headerIndex = { branch_id: 0, room_id: 1 }
  for (const line of lines) {
    if (!line.trim()) continue
    const values = parseLine(line)
    if (!headerFound) {
      const branchIndex = values.findIndex((value) => value.toLowerCase() === 'branch_id')
      const roomIndex = values.findIndex((value) => value.toLowerCase() === 'room_id')
      if (branchIndex >= 0 && roomIndex >= 0) {
        headerIndex = { branch_id: branchIndex, room_id: roomIndex }
        headerFound = true
      } else if (values.length >= 2) {
        rows.push({ branch_id: values[0], room_id: values[1] })
      }
      continue
    }
    rows.push({
      branch_id: values[headerIndex.branch_id],
      room_id: values[headerIndex.room_id],
    })
  }
  return rows.filter((row) => row.branch_id && row.room_id)
}

export function toRoomsCsv(rows) {
  return ['branch_id,room_id', ...rows.map((row) => `${row.branch_id},${row.room_id}`)].join('\n')
}