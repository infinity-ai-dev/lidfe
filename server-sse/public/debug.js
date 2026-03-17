let eventSource = null;
let eventCount = 0;
const baseUrl = window.location.origin;

function updateStatus(status, className) {
  const statusEl = document.getElementById('connection-status');
  statusEl.textContent = status;
  statusEl.className = className;
}

function updateEventCount() {
  document.getElementById('event-count').textContent = eventCount;
}

function updateLastUpdate() {
  document.getElementById('last-update').textContent = new Date().toLocaleTimeString();
}

function connect() {
  const userId = document.getElementById('user_id').value.trim();
  const threadId = document.getElementById('thread_id').value.trim();
  
  if (!userId || !threadId) {
    alert('Por favor, preencha User ID e Thread ID');
    return;
  }
  
  if (eventSource) {
    disconnect();
  }
  
  const url = `${baseUrl}/sse?user_id=${encodeURIComponent(userId)}&thread_id=${encodeURIComponent(threadId)}`;
  console.log('[DEBUG] Conectando em:', url);
  
  eventSource = new EventSource(url);
  
  eventSource.onopen = () => {
    console.log('[DEBUG] ✅ Conexão estabelecida');
    updateStatus('Conectado', 'status-connected');
    document.getElementById('connect-btn').disabled = true;
    document.getElementById('disconnect-btn').disabled = false;
    addEvent({
      type: 'system',
      message: 'Conexão estabelecida com sucesso',
      timestamp: new Date().toISOString()
    });
  };
  
  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      console.log('[DEBUG] 📨 Evento recebido:', data);
      eventCount++;
      updateEventCount();
      updateLastUpdate();
      addEvent(data);
    } catch (error) {
      console.error('[DEBUG] ❌ Erro ao processar evento:', error);
      addEvent({
        type: 'error',
        message: 'Erro ao processar evento: ' + error.message,
        raw: event.data
      });
    }
  };
  
  eventSource.onerror = (error) => {
    console.error('[DEBUG] ❌ Erro na conexão:', error);
    updateStatus('Erro na conexão', 'status-disconnected');
    addEvent({
      type: 'error',
      message: 'Erro na conexão SSE',
      error: error
    });
  };
}

function disconnect() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
    console.log('[DEBUG] ❌ Conexão fechada');
    updateStatus('Desconectado', 'status-disconnected');
    document.getElementById('connect-btn').disabled = false;
    document.getElementById('disconnect-btn').disabled = true;
    addEvent({
      type: 'system',
      message: 'Conexão fechada',
      timestamp: new Date().toISOString()
    });
  }
}

function addEvent(data) {
  const list = document.getElementById('event-list');
  const eventDiv = document.createElement('div');
  eventDiv.className = 'event';
  
  const timestamp = data.timestamp ? new Date(data.timestamp).toLocaleString() : new Date().toLocaleString();
  const type = data.type || 'message';
  
  eventDiv.innerHTML = `
    <div class="event-header">
      <span><strong>${type.toUpperCase()}</strong></span>
      <span>${timestamp}</span>
    </div>
    <div class="event-content">${JSON.stringify(data, null, 2)}</div>
  `;
  
  list.insertBefore(eventDiv, list.firstChild);
  
  // Limitar a 100 eventos
  while (list.children.length > 100) {
    list.removeChild(list.lastChild);
  }
}

async function sendTestMessage() {
  const userId = document.getElementById('user_id').value.trim();
  const threadId = document.getElementById('thread_id').value.trim();
  const testMessage = document.getElementById('test-message').value.trim();
  
  if (!userId || !threadId) {
    alert('Por favor, preencha User ID e Thread ID');
    return;
  }
  
  let messageData;
  try {
    messageData = JSON.parse(testMessage);
  } catch (error) {
    messageData = {
      message: testMessage || 'Mensagem de teste',
      role: 'assistant',
      type: 'text'
    };
  }
  
  messageData.user_id = userId;
  messageData.thread_id = threadId;
  
  try {
    const response = await fetch(`${baseUrl}/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(messageData)
    });
    
    const result = await response.json();
    
    if (response.ok) {
      addEvent({
        type: 'system',
        message: 'Mensagem de teste enviada com sucesso',
        data: result
      });
    } else {
      addEvent({
        type: 'error',
        message: 'Erro ao enviar mensagem de teste',
        error: result
      });
    }
  } catch (error) {
    console.error('[DEBUG] ❌ Erro ao enviar teste:', error);
    addEvent({
      type: 'error',
      message: 'Erro ao enviar mensagem de teste: ' + error.message
    });
  }
}

// Auto-conectar se houver parâmetros na URL
window.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const userId = params.get('user_id');
  const threadId = params.get('thread_id');
  
  if (userId && threadId) {
    document.getElementById('user_id').value = userId;
    document.getElementById('thread_id').value = threadId;
  }
});
