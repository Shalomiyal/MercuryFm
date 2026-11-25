// ExcelJS is large, so load it only when an Excel action is used.
async function getExcelJS() {
  const module = await import('exceljs')
  return module.default || module
}

const NAME_HEADERS = new Set(['taskname', 'task', 'name', 'taskdescription'])
const START_HEADERS = new Set(['starttime', 'start', 'startby', 'begins', 'from'])
const FINISH_HEADERS = new Set(['finishtime', 'finish', 'finishby', 'end', 'endtime', 'due', 'to'])
const BRANCH_HEADERS = new Set(['branchid', 'branch', 'branchcode'])
const ROOM_HEADERS = new Set(['roomid', 'room', 'roomnumber', 'roomname'])

function headerKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_\-.]+/g, '')
}

function cellText(cell) {
  const value = cell?.value
  if (value == null) return ''
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim()
  if (value instanceof Date) {
    return `${String(value.getUTCHours()).padStart(2, '0')}:${String(value.getUTCMinutes()).padStart(2, '0')}`
  }
  if (Array.isArray(value.richText)) {
    return value.richText.map((part) => part.text || '').join('').trim()
  }
  if (value.text != null) return String(value.text).trim()
  if (value.result != null) return cellText({ value: value.result })
  return ''
}

function excelTime(cell) {
  const value = cell?.value
  if (value == null) return ''
  if (typeof value === 'number' && value >= 0 && value < 1) {
    const totalMinutes = Math.round(value * 24 * 60)
    const hours = Math.floor(totalMinutes / 60) % 24
    return `${String(hours).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`
  }
  if (value instanceof Date) {
    return `${String(value.getUTCHours()).padStart(2, '0')}:${String(value.getUTCMinutes()).padStart(2, '0')}`
  }

  const text = cellText(cell).replace(/\s+/g, ' ')
  const match = text.match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(am|pm)?$/i)
  if (!match) return ''

  let hours = Number(match[1])
  const minutes = Number(match[2] || 0)
  const meridiem = match[3]?.toLowerCase()
  if (meridiem) {
    if (hours < 1 || hours > 12) return ''
    if (meridiem === 'am' && hours === 12) hours = 0
    if (meridiem === 'pm' && hours !== 12) hours += 12
  }
  if (hours > 23 || minutes > 59) return ''
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function rowCells(row) {
  const cells = []
  for (let index = 1; index <= (row.cellCount || 0); index += 1) {
    cells.push(row.getCell(index))
  }
  return cells
}

async function loadSheet(file) {
  if (!file) throw new Error('Choose an Excel file first.')
  const ExcelJS = await getExcelJS()
  const buffer = await file.arrayBuffer()
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const sheet = workbook.worksheets.find((item) => item.rowCount > 0) || workbook.worksheets[0]
  if (!sheet) throw new Error('That workbook has no worksheets.')
  const rows = []
  sheet.eachRow((row) => rows.push(row))
  return { sheetName: sheet.name, rows }
}

function findHeader(rows, matcher) {
  for (let index = 0; index < Math.min(rows.length, 10); index += 1) {
    const cells = rowCells(rows[index])
    if (cells.some((cell) => matcher.has(headerKey(cellText(cell))))) return index
  }
  return -1
}

export async function parseTaskWorkbook(file) {
  const { sheetName, rows } = await loadSheet(file)
  const headerIndex = findHeader(rows, NAME_HEADERS)
  if (headerIndex < 0) {
    throw new Error('Add a "Task name" column. Download the sample sheet to see the expected format.')
  }

  const headers = rowCells(rows[headerIndex])
    .map((cell, offset) => ({
      index: offset + 1,
      text: cellText(cell),
      key: headerKey(cellText(cell)),
    }))
    .filter((header) => header.text)

  const nameIndex = headers.find((header) => NAME_HEADERS.has(header.key))?.index
  const startIndex = headers.find((header) => START_HEADERS.has(header.key))?.index
  const finishIndex = headers.find((header) => FINISH_HEADERS.has(header.key))?.index
  if (!finishIndex) {
    throw new Error('Add a "Finish time" column (and optionally "Start time").')
  }

  const seenHeaders = new Set()
  const extraHeaders = headers
    .filter((header) => ![nameIndex, startIndex, finishIndex].includes(header.index))
    .filter((header) => {
      const key = headerKey(header.text)
      if (seenHeaders.has(key)) return false
      seenHeaders.add(key)
      return true
    })

  const tasks = []
  const issues = []
  for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const cells = rowCells(rows[rowIndex])
    const taskName = cellText(cells[nameIndex - 1])
    if (!taskName) continue

    const finishBy = excelTime(cells[finishIndex - 1])
    if (!finishBy) issues.push(`Row ${rowIndex + 1}: finish time is missing or invalid.`)

    tasks.push({
      task_name: taskName,
      start_by: startIndex ? excelTime(cells[startIndex - 1]) : '',
      finish_by: finishBy,
      fields: extraHeaders.map((header) => ({
        field_name: header.text,
        default_value: cellText(cells[header.index - 1]),
      })),
    })
  }

  if (!tasks.length) {
    throw new Error('No task rows were found below the header row.')
  }
  return { sheetName, tasks, issues, customColumns: extraHeaders.map((header) => header.text) }
}

export async function parseRoomsWorkbook(file) {
  const { sheetName, rows } = await loadSheet(file)
  const headerIndex = findHeader(rows, BRANCH_HEADERS)
  if (headerIndex < 0) throw new Error('Add a "branch_id" column to the sheet.')

  const headers = rowCells(rows[headerIndex])
    .map((cell, offset) => ({
      index: offset + 1,
      text: cellText(cell),
      key: headerKey(cellText(cell)),
    }))
    .filter((header) => header.text)

  const branchIndex = headers.find((header) => BRANCH_HEADERS.has(header.key))?.index
  const roomIndex = headers.find((header) => ROOM_HEADERS.has(header.key))?.index
  if (!roomIndex) throw new Error('Add a "room_id" column to the sheet.')

  const parsed = []
  for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const cells = rowCells(rows[rowIndex])
    const branchId = cellText(cells[branchIndex - 1])
    const roomId = cellText(cells[roomIndex - 1])
    if (branchId && roomId) parsed.push({ branch_id: branchId, room_id: roomId })
  }
  if (!parsed.length) throw new Error('No branch/room rows were found below the header row.')
  return { sheetName, rows: parsed }
}

async function downloadWorkbook(workbook, fileName) {
  const buffer = await workbook.xlsx.writeBuffer()
  const url = URL.createObjectURL(new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export async function downloadTaskWorkbook() {
  const ExcelJS = await getExcelJS()
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Tasks')
  sheet.addRow(['Task name', 'Start time', 'Finish time', 'Room notes'])
  sheet.addRow(['Vacuum carpet', '09:00', '10:30', 'Check under the bed'])
  sheet.addRow(['Clean bathroom', '10:30', '11:15', 'Replace towels'])
  sheet.getRow(1).font = { bold: true }
  sheet.columns = [
    { width: 26 },
    { width: 14 },
    { width: 14 },
    { width: 32 },
  ]
  return downloadWorkbook(workbook, 'mercuryfm-task-template.xlsx')
}

export async function downloadRoomsWorkbook() {
  const ExcelJS = await getExcelJS()
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Rooms')
  sheet.addRow(['branch_id', 'room_id'])
  sheet.addRow(['downtown', '101'])
  sheet.getRow(1).font = { bold: true }
  sheet.columns = [{ width: 20 }, { width: 16 }]
  return downloadWorkbook(workbook, 'mercuryfm-rooms-template.xlsx')
}
