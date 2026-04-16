import { useState, useEffect, useRef, useCallback } from "react";

const SUPABASE_URL = "https://jfzyueilhrbzkvllyjfd.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impmenl1ZWlsaHJiemt2bGx5amZkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNzgxOTksImV4cCI6MjA5MTg1NDE5OX0.sQms7Rbuv4d3WFQujtkE9KSvg7XBmCNrsp9TJS7Se7k";

const trucks = [
  { id: "T-01", name: "Camión 1", driver: "Miguel" },
  { id: "T-02", name: "Camión 2", driver: "Juan" },
];

const STATUS_CONFIG = {
  pendiente:  { label: "Pendiente",  color: "#F59E0B", bg: "rgba(245,158,11,0.15)" },
  en_ruta:    { label: "En Ruta",    color: "#38BDF8", bg: "rgba(56,189,248,0.15)" },
  incidencia: { label: "Incidencia", color: "#F87171", bg: "rgba(248,113,113,0.15)" },
  completado: { label: "Completado", color: "#34D399", bg: "rgba(52,211,153,0.15)" },
};

const TYPE_CONFIG = {
  entrega:  { label: "Entrega",  icon: "↓", color: "#818CF8" },
  recogida: { label: "Recogida", icon: "↑", color: "#F472B6" },
};

async function sbFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

const api = {
  getTasks:     () => sbFetch("tasks?order=created_at.desc&status=neq.completado"),
  getCompleted: () => sbFetch("tasks?order=created_at.desc&status=eq.completado"),
  createTask:   (data) => sbFetch("tasks", { method: "POST", body: JSON.stringify(data), headers: { "Prefer": "return=minimal" } }),
  updateTask:   (id, data) => sbFetch(`tasks?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(data), headers: { "Prefer": "return=minimal" } }),
  deleteTask:   (id) => sbFetch(`tasks?id=eq.${id}`, { method: "DELETE", headers: { "Prefer": "return=minimal" } }),
};

// Load Leaflet CSS + JS dynamically
function useLeaflet(onReady) {
  useEffect(() => {
    if (window.L) { onReady(); return; }
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
    document.head.appendChild(css);
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
    script.onload = onReady;
    document.head.appendChild(script);
  }, []);
}

// ── Map Picker Component ──────────────────────────────────────
function MapPicker({ initialAddress, initialLat, initialLng, onConfirm, onClose }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markerRef = useRef(null);
  const [leafletReady, setLeafletReady] = useState(!!window.L);
  const [search, setSearch] = useState(initialAddress || "");
  const [searching, setSearching] = useState(false);
  const [pickedAddress, setPickedAddress] = useState(initialAddress || "");
  const [pickedLat, setPickedLat] = useState(initialLat || null);
  const [pickedLng, setPickedLng] = useState(initialLng || null);
  const [searchError, setSearchError] = useState("");

  useLeaflet(() => setLeafletReady(true));

  const placeMarker = useCallback((lat, lng, address) => {
    const L = window.L;
    if (!mapInstanceRef.current) return;
    if (markerRef.current) markerRef.current.remove();
    const icon = L.divIcon({
      html: `<div style="font-size:32px;line-height:1;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5))">📍</div>`,
      className: "", iconAnchor: [16, 32], iconSize: [32, 32],
    });
    markerRef.current = L.marker([lat, lng], { icon, draggable: true }).addTo(mapInstanceRef.current);
    markerRef.current.on("dragend", async (e) => {
      const { lat: la, lng: lo } = e.target.getLatLng();
      setPickedLat(la); setPickedLng(lo);
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${la}&lon=${lo}&format=json`);
        const d = await r.json();
        const addr = d.display_name || `${la.toFixed(5)}, ${lo.toFixed(5)}`;
        setPickedAddress(addr); setSearch(addr);
      } catch { setPickedAddress(`${la.toFixed(5)}, ${lo.toFixed(5)}`); }
    });
    setPickedLat(lat); setPickedLng(lng);
    if (address) { setPickedAddress(address); setSearch(address); }
    mapInstanceRef.current.setView([lat, lng], 16);
  }, []);

  useEffect(() => {
    if (!leafletReady || !mapRef.current || mapInstanceRef.current) return;
    const L = window.L;
    const startLat = initialLat || 37.9922; // Murcia por defecto
    const startLng = initialLng || -1.1307;
    const map = L.map(mapRef.current, { zoomControl: true }).setView([startLat, startLng], initialLat ? 16 : 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap", maxZoom: 19
    }).addTo(map);
    map.on("click", async (e) => {
      const { lat, lng } = e.latlng;
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`);
        const d = await r.json();
        placeMarker(lat, lng, d.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`);
      } catch { placeMarker(lat, lng, `${lat.toFixed(5)}, ${lng.toFixed(5)}`); }
    });
    mapInstanceRef.current = map;
    if (initialLat && initialLng) placeMarker(initialLat, initialLng, initialAddress);
  }, [leafletReady]);

  const handleSearch = async () => {
    if (!search.trim()) return;
    setSearching(true); setSearchError("");
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(search)}&format=json&limit=1&countrycodes=es`);
      const d = await r.json();
      if (!d.length) { setSearchError("No encontrado. Prueba con más detalle."); setSearching(false); return; }
      placeMarker(parseFloat(d[0].lat), parseFloat(d[0].lon), d[0].display_name);
    } catch { setSearchError("Error de red."); }
    setSearching(false);
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)",
      backdropFilter: "blur(8px)", zIndex: 300,
      display: "flex", flexDirection: "column"
    }}>
      {/* Search bar */}
      <div style={{ background: "#0A1628", padding: "14px 14px 10px", borderBottom: "1px solid #1E2D3D" }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSearch()}
            placeholder="Busca una dirección..."
            style={{
              flex: 1, padding: "11px 14px", borderRadius: 10,
              border: "1px solid #1E2D3D", background: "#0D1B2A",
              color: "#E2E8F0", fontSize: 14, outline: "none", fontFamily: "inherit"
            }}
          />
          <button onClick={handleSearch} disabled={searching} style={{
            padding: "11px 16px", borderRadius: 10, border: "none",
            background: "linear-gradient(135deg,#4F46E5,#7C3AED)",
            color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 14, whiteSpace: "nowrap"
          }}>{searching ? "..." : "🔍"}</button>
        </div>
        {searchError && <div style={{ color: "#F87171", fontSize: 12, marginBottom: 4 }}>{searchError}</div>}
        <div style={{ color: "#475569", fontSize: 11 }}>
          💡 Busca o pulsa en el mapa para poner la chincheta. Puedes arrastrarla.
        </div>
      </div>

      {/* Map */}
      <div style={{ flex: 1, position: "relative" }}>
        {!leafletReady && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#475569", fontSize: 14, zIndex: 1 }}>
            Cargando mapa...
          </div>
        )}
        <div ref={mapRef} style={{ width: "100%", height: "100%" }} />
      </div>

      {/* Bottom panel */}
      <div style={{ background: "#0A1628", padding: "14px", borderTop: "1px solid #1E2D3D" }}>
        {pickedAddress && (
          <div style={{ color: "#94A3B8", fontSize: 12, marginBottom: 12, padding: "10px 12px", background: "#0D1B2A", borderRadius: 10, border: "1px solid #1E2D3D" }}>
            📍 {pickedAddress}
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
          <button onClick={onClose} style={{
            padding: "13px", borderRadius: 12, border: "1px solid #1E2D3D",
            background: "transparent", color: "#64748B", cursor: "pointer", fontWeight: 600, fontSize: 14
          }}>Cancelar</button>
          <button onClick={() => pickedLat && onConfirm(pickedAddress, pickedLat, pickedLng)} disabled={!pickedLat} style={{
            padding: "13px", borderRadius: 12, border: "none",
            background: pickedLat ? "linear-gradient(135deg,#4F46E5,#7C3AED)" : "#1E2D3D",
            color: pickedLat ? "#fff" : "#475569", cursor: pickedLat ? "pointer" : "default",
            fontWeight: 700, fontSize: 14
          }}>✅ Guardar ubicación</button>
        </div>
      </div>
    </div>
  );
}

// ── Task Modal ────────────────────────────────────────────────
const inp = {
  width: "100%", padding: "12px 14px", borderRadius: 10,
  border: "1px solid #1E2D3D", background: "#0D1B2A",
  color: "#E2E8F0", fontSize: 15, outline: "none",
  fontFamily: "inherit", boxSizing: "border-box",
};
const labelStyle = { display: "block", fontSize: 11, color: "#475569", marginBottom: 5, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" };

function TaskModal({ task, onClose, onSave, loading }) {
  const [form, setForm] = useState(task || {
    type: "entrega", truck: "T-01", client: "", address: "",
    lat: null, lng: null, time: "", status: "pendiente", weight: "", notes: ""
  });
  const [showMap, setShowMap] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleMapConfirm = (address, lat, lng) => {
    setForm(f => ({ ...f, address, lat, lng }));
    setShowMap(false);
  };

  return (
    <>
      <div style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)",
        backdropFilter: "blur(8px)", zIndex: 100,
        display: "flex", alignItems: "flex-end", justifyContent: "center"
      }} onClick={onClose}>
        <div style={{
          background: "#0A1628", border: "1px solid #1E2D3D",
          borderRadius: "20px 20px 0 0", padding: "20px 16px 36px",
          width: "100%", maxWidth: 540,
          boxShadow: "0 -20px 60px rgba(0,0,0,0.6)",
          maxHeight: "92vh", overflowY: "auto"
        }} onClick={e => e.stopPropagation()}>
          <div style={{ width: 36, height: 4, background: "#1E2D3D", borderRadius: 99, margin: "0 auto 18px" }} />
          <h3 style={{ margin: "0 0 18px", fontSize: 17, fontWeight: 700, color: "#E2E8F0" }}>
            {task ? "Editar tarea" : "Nueva tarea"}
          </h3>
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <label style={labelStyle}>Tipo</label>
                <select value={form.type} onChange={e => set("type", e.target.value)} style={inp}>
                  <option value="entrega">↓ Entrega</option>
                  <option value="recogida">↑ Recogida</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Conductor</label>
                <select value={form.truck} onChange={e => set("truck", e.target.value)} style={inp}>
                  {trucks.map(t => <option key={t.id} value={t.id}>{t.driver}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label style={labelStyle}>Cliente</label>
              <input value={form.client} onChange={e => set("client", e.target.value)} style={inp} placeholder="Nombre del cliente" />
            </div>

            {/* Address with map button */}
            <div>
              <label style={labelStyle}>Ubicación</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={form.address}
                  onChange={e => set("address", e.target.value)}
                  style={{ ...inp, flex: 1 }}
                  placeholder="Busca en el mapa →"
                  readOnly
                />
                <button
                  type="button"
                  onClick={() => setShowMap(true)}
                  style={{
                    width: 50, borderRadius: 10, border: form.lat ? "2px solid #4F46E5" : "1px solid #1E2D3D",
                    background: form.lat ? "rgba(79,70,229,0.15)" : "#0D1B2A",
                    cursor: "pointer", fontSize: 22,
                    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0
                  }}>📍</button>
              </div>
              {form.lat && (
                <div style={{ marginTop: 6, fontSize: 11, color: "#4F46E5" }}>
                  ✓ Ubicación guardada en el mapa
                </div>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <label style={labelStyle}>Hora</label>
                <input type="time" value={form.time} onChange={e => set("time", e.target.value)} style={inp} />
              </div>
              <div>
                <label style={labelStyle}>Peso</label>
                <input value={form.weight} onChange={e => set("weight", e.target.value)} style={inp} placeholder="ej. 200 kg" />
              </div>
            </div>

            <div>
              <label style={labelStyle}>Estado</label>
              <select value={form.status} onChange={e => set("status", e.target.value)} style={inp}>
                {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Notas</label>
              <input value={form.notes} onChange={e => set("notes", e.target.value)} style={inp} placeholder="Instrucciones especiales..." />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10, marginTop: 18 }}>
            <button onClick={onClose} style={{ padding: "14px", borderRadius: 12, border: "1px solid #1E2D3D", background: "transparent", color: "#64748B", cursor: "pointer", fontWeight: 600, fontSize: 15 }}>
              Cancelar
            </button>
            <button onClick={() => onSave(form)} disabled={loading} style={{
              padding: "14px", borderRadius: 12, border: "none",
              background: loading ? "#1E2D3D" : "linear-gradient(135deg,#4F46E5,#7C3AED)",
              color: loading ? "#475569" : "#fff", cursor: loading ? "default" : "pointer", fontWeight: 700, fontSize: 15
            }}>
              {loading ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </div>
      </div>

      {showMap && (
        <MapPicker
          initialAddress={form.address}
          initialLat={form.lat}
          initialLng={form.lng}
          onConfirm={handleMapConfirm}
          onClose={() => setShowMap(false)}
        />
      )}
    </>
  );
}

function DeleteModal({ onConfirm, onCancel, loading }) {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)",
      backdropFilter: "blur(8px)", zIndex: 200,
      display: "flex", alignItems: "flex-end", justifyContent: "center"
    }} onClick={onCancel}>
      <div style={{
        background: "#0A1628", border: "1px solid #1E2D3D",
        borderRadius: "20px 20px 0 0", padding: "24px 20px 36px",
        width: "100%", maxWidth: 540, textAlign: "center"
      }} onClick={e => e.stopPropagation()}>
        <div style={{ width: 36, height: 4, background: "#1E2D3D", borderRadius: 99, margin: "0 auto 20px" }} />
        <div style={{ fontSize: 36, marginBottom: 10 }}>🗑️</div>
        <div style={{ fontWeight: 700, fontSize: 17, color: "#E2E8F0", marginBottom: 6 }}>¿Eliminar tarea?</div>
        <div style={{ color: "#475569", fontSize: 13, marginBottom: 24 }}>No se puede deshacer</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <button onClick={onCancel} style={{ padding: "14px", borderRadius: 12, border: "1px solid #1E2D3D", background: "transparent", color: "#64748B", cursor: "pointer", fontWeight: 600, fontSize: 15 }}>Cancelar</button>
          <button onClick={onConfirm} disabled={loading} style={{ padding: "14px", borderRadius: 12, border: "none", background: "#EF4444", color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 15 }}>
            {loading ? "..." : "Eliminar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Badge({ status }) {
  const c = STATUS_CONFIG[status] || STATUS_CONFIG.pendiente;
  return <span style={{ background: c.bg, color: c.color, borderRadius: 20, padding: "2px 9px", fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{c.label}</span>;
}
function TypeBadge({ type }) {
  const t = TYPE_CONFIG[type];
  return <span style={{ background: `${t.color}20`, color: t.color, borderRadius: 20, padding: "2px 9px", fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", whiteSpace: "nowrap" }}>{t.icon} {t.label}</span>;
}

// ── Mini map on task card ─────────────────────────────────────
function MiniMap({ lat, lng, address }) {
  const ref = useRef(null);
  const [ready, setReady] = useState(!!window.L);
  useLeaflet(() => setReady(true));

  useEffect(() => {
    if (!ready || !ref.current) return;
    const L = window.L;
    const map = L.map(ref.current, { zoomControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false, attributionControl: false }).setView([lat, lng], 15);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
    const icon = L.divIcon({ html: `<div style="font-size:24px;line-height:1">📍</div>`, className: "", iconAnchor: [12, 24], iconSize: [24, 24] });
    L.marker([lat, lng], { icon }).addTo(map);
    return () => map.remove();
  }, [ready, lat, lng]);

  const openGoogleMaps = () => {
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, "_blank");
  };

  return (
    <div style={{ marginTop: 10, borderRadius: 12, overflow: "hidden", border: "1px solid #1E2D3D", position: "relative" }}>
      <div ref={ref} style={{ height: 130, width: "100%" }} />
      <button
        onClick={openGoogleMaps}
        style={{
          position: "absolute", bottom: 8, right: 8, zIndex: 1000,
          background: "#4F46E5", border: "none", color: "#fff",
          borderRadius: 8, padding: "6px 12px", cursor: "pointer",
          fontSize: 12, fontWeight: 700, boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
          display: "flex", alignItems: "center", gap: 4
        }}>
        🚗 Navegar
      </button>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────
export default function App() {
  const [tasks, setTasks] = useState([]);
  const [completed, setCompleted] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [activeTab, setActiveTab] = useState("activas");
  const [filterTruck, setFilterTruck] = useState("all");

  useEffect(() => {
    const link = document.createElement("link");
    link.href = "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap";
    link.rel = "stylesheet";
    document.head.appendChild(link);

    // Add lat/lng columns to Supabase if not exists (safe to run multiple times)
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true); setError(null);
    try {
      const [active, done] = await Promise.all([api.getTasks(), api.getCompleted()]);
      setTasks(active || []);
      setCompleted(done || []);
    } catch (e) {
      setError("Error al cargar. Comprueba tu conexión.");
    } finally {
      setLoading(false);
    }
  };

  const saveTask = async (form) => {
    setSaving(true); setError(null);
    try {
      const { id, created_at, ...data } = form;
      const clean = Object.fromEntries(Object.entries(data).map(([k, v]) => {
        if (k === "lat" || k === "lng") return [k, v || null];
        return [k, v ?? ""];
      }));
      if (id) { await api.updateTask(id, clean); } else { await api.createTask(clean); }
      setModal(null);
      await loadData();
    } catch (e) {
      setError("Error al guardar: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const markComplete = async (id) => {
    try { await api.updateTask(id, { status: "completado" }); await loadData(); }
    catch { setError("Error al actualizar."); }
  };

  const handleDelete = async () => {
    setSaving(true);
    try { await api.deleteTask(deleteId); setDeleteId(null); await loadData(); }
    catch { setError("Error al eliminar."); }
    finally { setSaving(false); }
  };

  const cycleStatus = async (task) => {
    const order = ["pendiente", "en_ruta", "incidencia"];
    const next = order[(order.indexOf(task.status) + 1) % order.length];
    try {
      await api.updateTask(task.id, { status: next });
      setTasks(ts => ts.map(t => t.id === task.id ? { ...t, status: next } : t));
    } catch { setError("Error al actualizar."); }
  };

  const filtered = (activeTab === "activas" ? tasks : completed).filter(t =>
    filterTruck === "all" || t.truck === filterTruck
  );

  const stats = {
    pendiente: tasks.filter(t => t.status === "pendiente").length,
    en_ruta: tasks.filter(t => t.status === "en_ruta").length,
    incidencia: tasks.filter(t => t.status === "incidencia").length,
    completado: completed.length,
  };

  return (
    <div style={{ minHeight: "100vh", background: "#060D1A", color: "#E2E8F0", fontFamily: "'Plus Jakarta Sans', sans-serif", paddingBottom: 100 }}>
      {/* Header */}
      <div style={{ background: "#0A1628", borderBottom: "1px solid #1E2D3D", padding: "16px 16px 0", position: "sticky", top: 0, zIndex: 50 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: "linear-gradient(135deg,#4F46E5,#7C3AED)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🚛</div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16, lineHeight: 1 }}>FleetDesk</div>
              <div style={{ fontSize: 10, color: "#475569", marginTop: 2 }}>Rutas en tiempo real</div>
            </div>
          </div>
          <button onClick={loadData} style={{ background: "#1E2D3D", border: "none", color: "#94A3B8", width: 34, height: 34, borderRadius: 10, cursor: "pointer", fontSize: 16 }}>↻</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 14 }}>
          {[
            { label: "Pend.", value: stats.pendiente, color: "#F59E0B" },
            { label: "Ruta", value: stats.en_ruta, color: "#38BDF8" },
            { label: "Incid.", value: stats.incidencia, color: "#F87171" },
            { label: "Hecho", value: stats.completado, color: "#34D399" },
          ].map(s => (
            <div key={s.label} style={{ background: "#0D1B2A", borderRadius: 10, padding: "8px 6px", textAlign: "center" }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</div>
              <div style={{ fontSize: 9, color: "#475569", marginTop: 3, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{s.label}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex" }}>
          {[["activas","Activas"],["completadas","Completadas"]].map(([k,l]) => (
            <button key={k} onClick={() => setActiveTab(k)} style={{
              flex: 1, padding: "10px", border: "none", background: "transparent",
              color: activeTab === k ? "#818CF8" : "#475569", fontWeight: 700, fontSize: 13,
              cursor: "pointer", borderBottom: activeTab === k ? "2px solid #818CF8" : "2px solid transparent",
              transition: "all 0.2s", fontFamily: "inherit"
            }}>{l}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: "16px" }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center" }}>
          <select value={filterTruck} onChange={e => setFilterTruck(e.target.value)} style={{ flex: 1, padding: "9px 12px", borderRadius: 10, border: "1px solid #1E2D3D", background: "#0D1B2A", color: "#E2E8F0", fontSize: 13, outline: "none", fontFamily: "inherit" }}>
            <option value="all">Todos los conductores</option>
            {trucks.map(t => <option key={t.id} value={t.id}>{t.driver}</option>)}
          </select>
          <div style={{ color: "#475569", fontSize: 12, whiteSpace: "nowrap" }}>{filtered.length} tareas</div>
        </div>

        {error && (
          <div style={{ background: "rgba(248,113,113,0.1)", border: "1px solid #F87171", borderRadius: 12, padding: "12px 16px", marginBottom: 14, color: "#F87171", fontSize: 13, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            {error}
            <button onClick={() => setError(null)} style={{ background: "none", border: "none", color: "#F87171", cursor: "pointer", fontSize: 18 }}>×</button>
          </div>
        )}

        {loading && (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "#475569" }}>
            <div style={{ fontSize: 30, marginBottom: 10 }}>⏳</div>
            <div style={{ fontSize: 14 }}>Cargando...</div>
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "#334155" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>
              {activeTab === "activas" ? "No hay tareas activas" : "No hay tareas completadas"}
            </div>
            {activeTab === "activas" && <div style={{ fontSize: 13, marginTop: 6, color: "#1E2D3D" }}>Pulsa + para añadir una</div>}
          </div>
        )}

        <div style={{ display: "grid", gap: 12 }}>
          {filtered.map(task => {
            const truck = trucks.find(t => t.id === task.truck);
            const isCompleted = task.status === "completado";
            return (
              <div key={task.id} style={{
                background: "#0A1628",
                border: `1px solid ${isCompleted ? "#1E2D3D" : (TYPE_CONFIG[task.type]?.color + "40") || "#1E2D3D"}`,
                borderRadius: 16, overflow: "hidden", opacity: isCompleted ? 0.75 : 1
              }}>
                <div style={{ height: 3, background: isCompleted ? "#1E2D3D" : `linear-gradient(90deg, ${TYPE_CONFIG[task.type]?.color}, transparent)` }} />
                <div style={{ padding: "14px 14px 12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                    <TypeBadge type={task.type} />
                    <Badge status={task.status} />
                    {task.time && <span style={{ marginLeft: "auto", color: "#94A3B8", fontSize: 12, fontWeight: 600 }}>🕐 {task.time}</span>}
                  </div>

                  <div style={{ fontWeight: 700, fontSize: 16, color: "#F1F5F9", marginBottom: 4 }}>
                    {task.client || "Sin cliente"}
                  </div>

                  {task.address && !task.lat && (
                    <div style={{ color: "#64748B", fontSize: 13, marginBottom: 6 }}>📍 {task.address}</div>
                  )}

                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
                    {truck && <span style={{ color: "#475569", fontSize: 12 }}>🚛 {truck.driver}</span>}
                    {task.weight && <span style={{ color: "#475569", fontSize: 12 }}>⚖️ {task.weight}</span>}
                    {task.notes && <span style={{ color: "#92400E", fontSize: 12 }}>📝 {task.notes}</span>}
                  </div>

                  {/* Mini map if location saved */}
                  {task.lat && task.lng && (
                    <MiniMap lat={parseFloat(task.lat)} lng={parseFloat(task.lng)} address={task.address} />
                  )}

                  {!isCompleted && (
                    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                      <button onClick={() => markComplete(task.id)} style={{ flex: 2, padding: "10px", borderRadius: 10, border: "none", background: "rgba(52,211,153,0.15)", color: "#34D399", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
                        ✅ Completar
                      </button>
                      <button onClick={() => cycleStatus(task)} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "1px solid #1E2D3D", background: "transparent", color: "#94A3B8", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                        ⟳ Estado
                      </button>
                      <button onClick={() => setModal(task)} style={{ width: 40, padding: "10px", borderRadius: 10, border: "1px solid #1E2D3D", background: "transparent", color: "#818CF8", cursor: "pointer", fontSize: 15 }}>✏️</button>
                      <button onClick={() => setDeleteId(task.id)} style={{ width: 40, padding: "10px", borderRadius: 10, border: "1px solid #1E2D3D", background: "transparent", color: "#F87171", cursor: "pointer", fontSize: 15 }}>🗑</button>
                    </div>
                  )}

                  {isCompleted && (
                    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
                      <button onClick={() => setDeleteId(task.id)} style={{ padding: "8px 14px", borderRadius: 10, border: "1px solid #1E2D3D", background: "transparent", color: "#475569", cursor: "pointer", fontSize: 12 }}>
                        🗑 Eliminar
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {activeTab === "activas" && (
        <button onClick={() => setModal("new")} style={{
          position: "fixed", bottom: 28, right: 20, width: 58, height: 58, borderRadius: 29,
          background: "linear-gradient(135deg,#4F46E5,#7C3AED)", border: "none", color: "#fff",
          fontSize: 28, cursor: "pointer", boxShadow: "0 8px 32px rgba(79,70,229,0.5)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60
        }}>+</button>
      )}

      {modal && <TaskModal task={modal === "new" ? null : modal} onClose={() => setModal(null)} onSave={saveTask} loading={saving} />}
      {deleteId && <DeleteModal onConfirm={handleDelete} onCancel={() => setDeleteId(null)} loading={saving} />}
    </div>
  );
}
