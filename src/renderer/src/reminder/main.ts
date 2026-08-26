import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('missing root')

root.innerHTML = `
  <div class="card">
    <div class="kicker">灵 · 提醒</div>
    <p class="message" id="message">…</p>
    <div class="actions">
      <button class="later" type="button" id="later">5 分钟后再说</button>
      <button class="ok" type="button" id="ok">知道了</button>
    </div>
  </div>
`

let reminderId = ''
const messageEl = document.getElementById('message') as HTMLParagraphElement

window.ling.on('reminder:payload', (payload) => {
  const data = payload as { id?: string; text?: string }
  reminderId = data.id || ''
  messageEl.textContent = data.text || '到点啦'
})

document.getElementById('ok')?.addEventListener('click', () => {
  if (reminderId) window.ling.dismissReminder(reminderId)
})

document.getElementById('later')?.addEventListener('click', () => {
  if (reminderId) window.ling.snoozeReminder(reminderId, 5)
})
