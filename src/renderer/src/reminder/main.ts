import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('missing root')

root.innerHTML = `
  <div class="card">
    <div class="top">
      <div class="kicker">到点了</div>
      <div class="when" id="when"></div>
    </div>
    <p class="message" id="message">…</p>
    <div class="actions">
      <button class="later" type="button" id="later">5 分钟后</button>
      <button class="ok" type="button" id="ok">知道了</button>
    </div>
  </div>
`

let reminderId = ''
const messageEl = document.getElementById('message') as HTMLParagraphElement
const whenEl = document.getElementById('when') as HTMLDivElement
const okBtn = document.getElementById('ok') as HTMLButtonElement

function clockLabel(at?: number): string {
  const date = new Date(at || Date.now())
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

window.ling.on('reminder:payload', (payload) => {
  const data = payload as { id?: string; text?: string; at?: number }
  reminderId = data.id || ''
  const text = (data.text || '到点啦').trim()
  messageEl.textContent = text
  messageEl.classList.toggle('short', text.length <= 12)
  whenEl.textContent = clockLabel(data.at)
  okBtn.focus()
})

document.getElementById('ok')?.addEventListener('click', () => {
  if (reminderId) window.ling.dismissReminder(reminderId)
})

document.getElementById('later')?.addEventListener('click', () => {
  if (reminderId) window.ling.snoozeReminder(reminderId, 5)
})

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' || event.key === 'Enter') {
    event.preventDefault()
    if (reminderId) window.ling.dismissReminder(reminderId)
  }
})
