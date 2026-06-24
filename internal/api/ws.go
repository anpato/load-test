package api

import (
	"context"
	"net/http"
	"sync"

	"github.com/coder/websocket"
)

type Hub struct {
	mu      sync.RWMutex
	clients map[string]map[*websocket.Conn]bool
}

func NewHub() *Hub {
	return &Hub{
		clients: make(map[string]map[*websocket.Conn]bool),
	}
}

func (h *Hub) Register(runID string, conn *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.clients[runID] == nil {
		h.clients[runID] = make(map[*websocket.Conn]bool)
	}
	h.clients[runID][conn] = true
}

func (h *Hub) Unregister(runID string, conn *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if conns, ok := h.clients[runID]; ok {
		delete(conns, conn)
		if len(conns) == 0 {
			delete(h.clients, runID)
		}
	}
}

func (h *Hub) Broadcast(runID string, data []byte) {
	h.mu.RLock()
	conns := h.clients[runID]
	// Copy to avoid holding the lock during sends.
	targets := make([]*websocket.Conn, 0, len(conns))
	for conn := range conns {
		targets = append(targets, conn)
	}
	h.mu.RUnlock()

	for _, conn := range targets {
		conn.Write(context.Background(), websocket.MessageText, data)
	}
}

func (h *Hub) CleanupRun(runID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.clients, runID)
}

func (s *Server) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true,
	})
	if err != nil {
		return
	}

	s.hub.Register(id, conn)
	defer s.hub.Unregister(id, conn)

	// Block until client disconnects or server context is done.
	ctx := conn.CloseRead(r.Context())
	<-ctx.Done()
	conn.Close(websocket.StatusNormalClosure, "")
}
