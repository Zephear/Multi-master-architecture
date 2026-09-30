let MY_NODE = null;
let editingTicketId = null;
const OWNER_NAMES = {
  'node-1': 'Bratislava',
  'node-2': 'Košice',
  'node-3': 'Žilina'
};

async function loadNodeInfo() {
  const r = await fetch('/api/node-info');
  const data = await r.json();
  MY_NODE = data.node_id;
  document.getElementById('nodeId').textContent = data.node_id;
}

async function loadTickets() {
  const r = await fetch('/api/tickets');
  const tickets = await r.json();
  const body = document.getElementById('ticketsBody');
  body.innerHTML = '';

  tickets.forEach(t => {
    const isMine = t.owner_node_id === MY_NODE;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(t.title)}</td>
      <td>${escapeHtml(t.description || '')}</td>
      <td><span class="status-pill ${t.status}">${t.status}</span></td>
      <td class="${isMine ? 'owner-mine' : 'owner-other'}">${escapeHtml(OWNER_NAMES[t.owner_node_id] || t.owner_node_id)}</td>
      <td>${new Date(t.updated_at).toLocaleString()}</td>
      <td>
        ${isMine
          ? `<div class="actions-cell">
               <button class="action-btn edit" onclick='openEditModal(${JSON.stringify(t)})'>Edit</button>
               <button class="action-btn delete" onclick="deleteTicket('${t.id}')">Delete</button>
             </div>`
          : `<span class="no-actions">read only</span>`
        }
      </td>
    `;
    body.appendChild(tr);
  });
}

async function loadStatus() {
  const r = await fetch('/api/status');
  const data = await r.json();
  const el = document.getElementById('peers');
  el.innerHTML = data.peers.length
    ? data.peers.map(p => `
        <div class="peer-row">
          <span><span class="dot ${p.online ? 'dot-ok' : 'dot-bad'}"></span>${p.peer}</span>
          <span>${p.online ? 'online' : 'unreachable'}</span>
        </div>`).join('')
    : '<div class="peer-row">No peers configured</div>';

  document.getElementById('pending').textContent =
    data.pending_operations > 0
      ? `Operations waiting to sync: ${data.pending_operations}`
      : 'Everything is synced.';
}

async function createTicket() {
  const title = document.getElementById('title').value.trim();
  const description = document.getElementById('description').value.trim();
  if (!title) return alert('Please enter a title');

  const r = await fetch('/api/tickets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, description })
  });

  if (!r.ok) {
    const err = await r.json();
    return alert(err.error || 'Failed to create ticket');
  }

  document.getElementById('title').value = '';
  document.getElementById('description').value = '';
  loadTickets();
}

function openEditModal(ticket) {
  editingTicketId = ticket.id;
  document.getElementById('editTitle').value = ticket.title;
  document.getElementById('editDescription').value = ticket.description || '';
  document.getElementById('editStatus').value = ticket.status;
  document.getElementById('editOverlay').classList.remove('hidden');
}

function closeEditModal() {
  editingTicketId = null;
  document.getElementById('editOverlay').classList.add('hidden');
}

async function saveEdit() {
  if (!editingTicketId) return;

  const title = document.getElementById('editTitle').value.trim();
  const description = document.getElementById('editDescription').value.trim();
  const status = document.getElementById('editStatus').value;

  if (!title) return alert('Please enter a title');

  const r = await fetch(`/api/tickets/${editingTicketId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, description, status })
  });

  if (!r.ok) {
    const err = await r.json();
    alert(err.error || 'Failed to update ticket');
  }

  closeEditModal();
  loadTickets();
}

async function deleteTicket(id) {
  if (!confirm('Delete this ticket?')) return;

  const r = await fetch(`/api/tickets/${id}`, { method: 'DELETE' });

  if (!r.ok) {
    const err = await r.json();
    alert(err.error || 'Failed to delete ticket');
  }

  loadTickets();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function init() {
  await loadNodeInfo();
  await loadTickets();
  await loadStatus();
  setInterval(loadTickets, 3000);
  setInterval(loadStatus, 3000);
}

init();
