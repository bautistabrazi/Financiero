import { ChangeEvent, useMemo, useState } from "react";

type Movement = {
  date: string;
  description: string;
  id: string;
  amount: number;
  balance: number;
  category: string;
  excluded: boolean;
};

type Report = {
  name: string;
  initial: number;
  credits: number;
  debits: number;
  final: number;
  movements: Movement[];
};

type SettlementItem = {
  id: string;
  date: string;
  type: string;
  gross: number;
  fees: number;
  taxes: number;
  net: number;
  business: string;
};

type SettlementReport = {
  name: string;
  items: SettlementItem[];
};

const money = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

function parseMoney(value = "0") {
  return Number(value.replace(/\./g, "").replace(",", ".")) || 0;
}

function parseDecimal(value = "0") {
  return Number(value) || 0;
}

function parseSettlementReport(text: string, name: string): SettlementReport {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  const headers = lines[0]?.split(";") ?? [];
  const index = (column: string) => headers.indexOf(column);
  if (index("TRANSACTION_TYPE") < 0 || index("REAL_AMOUNT") < 0) {
    throw new Error("Este archivo no es el reporte de liquidaciones de Mercado Pago.");
  }
  const items = lines.slice(1).map((line) => {
    const cells = line.split(";");
    return {
      id: cells[index("SOURCE_ID")] || "",
      date: (cells[index("SETTLEMENT_DATE")] || cells[index("TRANSACTION_DATE")] || "").slice(0, 10),
      type: cells[index("TRANSACTION_TYPE")] || "OTHER",
      gross: parseDecimal(cells[index("TRANSACTION_AMOUNT")]),
      fees: parseDecimal(cells[index("FEE_AMOUNT")]),
      taxes: parseDecimal(cells[index("TAXES_AMOUNT")]),
      net: parseDecimal(cells[index("REAL_AMOUNT")]),
      business: cells[index("BUSINESS_UNIT")] || "Sin unidad",
    };
  }).filter((item) => item.id);
  return { name, items };
}

function classify(description: string) {
  const text = description.toLocaleLowerCase("es");
  const isReserve = text.includes("reserva programada") || text.includes("dinero reservado") || text.includes("dinero retirado");
  if (isReserve && /\bsj\b/.test(text)) return { category: "Reserva SJ", excluded: true };
  if (isReserve && (text.includes("impuesto") || text.includes("impositivo")))
    return { category: "Reserva publicidad e impuestos", excluded: true };
  if (isReserve && text.includes("stock")) return { category: "Reserva stock", excluded: true };
  if (isReserve)
    return { category: "Reservas", excluded: true };
  if (text.includes("transferencia enviada bautista brazi") || text.includes("transferencia recibida bautista brazi"))
    return { category: "Movimiento propio", excluded: true };
  if (text.includes("liquidación de dinero")) return { category: "Liquidaciones", excluded: false };
  if (text.includes("transferencia enviada silvana anahi britez")) return { category: "Servicios", excluded: false };
  if (text.includes("transferencia enviada")) return { category: "Transferencias enviadas", excluded: false };
  if (text.includes("transferencia recibida")) return { category: "Transferencias recibidas", excluded: false };
  if (text.includes("devoluci") || text.includes("reclamo") || text.includes("retenido") || text.includes("débito por deuda"))
    return { category: "Devoluciones y reclamos", excluded: false };
  if (text.includes("bonificación") || text.includes("protección de mercado envíos"))
    return { category: "Bonificaciones", excluded: false };
  if (text.includes("rendimiento")) return { category: "Rendimientos", excluded: false };
  if (text.includes("pago") || text.includes("compra")) return { category: "Pagos y compras", excluded: false };
  return { category: "Otros", excluded: false };
}

function parseReport(text: string, name: string): Report {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  const totals = lines[1]?.split(";") ?? [];
  const headerIndex = lines.findIndex((line) => line.startsWith("RELEASE_DATE;"));
  if (headerIndex < 0) throw new Error("No encontramos la tabla de movimientos de Mercado Pago.");
  const movements = lines.slice(headerIndex + 1).map((line) => {
    const [date, rawDescription, id, amount, balance] = line.split(";");
    const description = (rawDescription || "Sin descripción").trim();
    return { date, description, id, amount: parseMoney(amount), balance: parseMoney(balance), ...classify(description) };
  }).filter((row) => row.date && row.id);
  return {
    name,
    initial: parseMoney(totals[0]),
    credits: parseMoney(totals[1]),
    debits: parseMoney(totals[2]),
    final: parseMoney(totals[3]),
    movements,
  };
}

function counterpart(movement: Movement) {
  return movement.description
    .replace(/^Transferencia (enviada|recibida)\s+/i, "")
    .replace(/^Pago con QR\s+/i, "")
    .trim();
}

function dateValue(date: string) {
  const [day, month, year] = date.split("-").map(Number);
  return new Date(year, month - 1, day).getTime();
}

function displayDate(date: string) {
  const [day, month, year] = date.split("-");
  return `${day}/${month}/${year}`;
}

export default function Home() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [flow, setFlow] = useState<"all" | "income" | "expense">("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"desc" | "asc">("desc");
  const [expanded, setExpanded] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [settlementReport, setSettlementReport] = useState<SettlementReport | null>(null);
  const [settlementError, setSettlementError] = useState("");
  const [lastUpdate, setLastUpdate] = useState("");

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setReport(parseReport(await file.text(), file.name));
      setSettlementReport(null);
      setActiveCategory(null);
      setExpanded(false);
      setFlow("all");
      setQuery("");
      setLastUpdate(new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit" }).format(new Date()));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos leer el archivo.");
    } finally {
      input.value = "";
    }
  }

  async function uploadSettlement(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setSettlementReport(parseSettlementReport(await file.text(), file.name));
      setSettlementError("");
    } catch (reason) {
      setSettlementError(reason instanceof Error ? reason.message : "No pudimos leer el reporte de liquidaciones.");
    }
  }

  const stats = useMemo(() => {
    if (!report) return null;
    const included = report.movements.filter((m) => !m.excluded);
    const income = included.filter((m) => m.amount > 0).reduce((sum, m) => sum + m.amount, 0);
    const expense = included.filter((m) => m.amount < 0).reduce((sum, m) => sum + Math.abs(m.amount), 0);
    const liquidated = report.movements.filter((m) => m.category === "Liquidaciones").reduce((sum, m) => sum + m.amount, 0);
    const excluded = report.movements.filter((m) => m.excluded).reduce((sum, m) => sum + Math.abs(m.amount), 0);
    const sortedDates = report.movements.map((movement) => movement.date).sort((a, b) => dateValue(a) - dateValue(b));
    const period = sortedDates.length ? `${displayDate(sortedDates[0])} al ${displayDate(sortedDates[sortedDates.length - 1])}` : "Sin fechas";
    const groups = new Map<string, { amount: number; count: number }>();
    included.filter((m) => m.amount < 0).forEach((m) => {
      const key = counterpart(m);
      const current = groups.get(key) ?? { amount: 0, count: 0 };
      groups.set(key, { amount: current.amount + Math.abs(m.amount), count: current.count + 1 });
    });
    const top = [...groups.entries()].sort((a, b) => b[1].amount - a[1].amount).slice(0, 5);
    const categoryOrder = [
      "Liquidaciones",
      "Servicios",
      "Transferencias enviadas",
      "Transferencias recibidas",
      "Pagos y compras",
      "Devoluciones y reclamos",
      "Bonificaciones",
      "Rendimientos",
      "Otros",
      "Reserva SJ",
      "Reserva publicidad e impuestos",
      "Reserva stock",
      "Reservas",
      "Movimiento propio",
    ];
    const breakdown = categoryOrder.map((category) => {
      const categoryMovements = report.movements.filter((m) => m.category === category);
      return {
        category,
        count: categoryMovements.length,
        total: categoryMovements.reduce((sum, m) => sum + m.amount, 0),
        excluded: categoryMovements.some((m) => m.excluded),
      };
    }).filter((group) => group.count > 0);
    return { income, expense, liquidated, excluded, net: income - expense, top, breakdown, period };
  }, [report]);

  const rows = useMemo(() => {
    if (!report) return [];
    return report.movements
      .filter((m) => flow === "all" || (flow === "income" ? m.amount > 0 : m.amount < 0))
      .filter((m) => `${m.description} ${m.category}`.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => sort === "desc" ? Math.abs(b.amount) - Math.abs(a.amount) : Math.abs(a.amount) - Math.abs(b.amount));
  }, [report, flow, query, sort]);

  const visibleRows = expanded ? rows : rows.slice(0, 10);
  const reserveSJTarget = 800000;
  const reserveSJBalance = report
    ? Math.max(0, -report.movements.filter((movement) => movement.category === "Reserva SJ").reduce((sum, movement) => sum + movement.amount, 0))
    : 0;
  const modalMovements = report && activeCategory
    ? report.movements.filter((movement) => movement.category === activeCategory)
    : [];
  const modalGroups = useMemo(() => {
    const groups = new Map<string, { count: number; total: number }>();
    modalMovements.forEach((movement) => {
      const name = counterpart(movement);
      const current = groups.get(name) ?? { count: 0, total: 0 };
      groups.set(name, { count: current.count + 1, total: current.total + movement.amount });
    });
    return [...groups.entries()].sort((a, b) => Math.abs(b[1].total) - Math.abs(a[1].total));
  }, [modalMovements]);

  const settlementBreakdown = useMemo(() => {
    if (!settlementReport) return [];
    const definitions = [
      { label: "Productos vendidos", test: (item: SettlementItem) => item.business === "Mercado Libre" && item.type === "SETTLEMENT" },
      { label: "Envíos", test: (item: SettlementItem) => item.type === "SETTLEMENT_SHIPPING" },
      { label: "Bonificaciones", test: (item: SettlementItem) => item.type === "CASHBACK" },
      { label: "Devoluciones", test: (item: SettlementItem) => item.type === "REFUND" },
      { label: "Reclamos y disputas", test: (item: SettlementItem) => item.type.startsWith("DISPUTE") },
    ];
    return definitions.map((definition) => {
      const items = settlementReport.items.filter(definition.test);
      return {
        label: definition.label,
        count: items.length,
        gross: items.reduce((sum, item) => sum + item.gross, 0),
        fees: items.reduce((sum, item) => sum + item.fees, 0),
        taxes: items.reduce((sum, item) => sum + item.taxes, 0),
        net: items.reduce((sum, item) => sum + item.net, 0),
      };
    }).filter((group) => group.count > 0);
  }, [settlementReport]);

  return (
    <main>
      <header className="topbar">
        <div className="brand"><div className="brand-mark"><img src="/logo-bg-tienda.png" alt="BG Tienda" /></div><div><strong>Análisis de flujo</strong><small>Panel financiero · BG Tienda</small></div></div>
        {report && <div className="update-area"><span>{lastUpdate ? `Actualizado ${lastUpdate}` : report.name}</span><label className="upload compact">Reemplazar reporte<input type="file" accept=".csv" onChange={upload} /></label></div>}
      </header>

      {!report ? (
        <section className="welcome">
          <div className="eyebrow">Tu dinero, explicado con claridad</div>
          <h1>Análisis de flujo</h1>
          <p>Cargá el estado de cuenta de Mercado Pago. Las reservas y movimientos propios se separan automáticamente para no distorsionar el resultado.</p>
          <label className="upload">Elegir reporte CSV<input type="file" accept=".csv" onChange={upload} /></label>
          {error && <p className="error">{error}</p>}
          <small>El archivo se procesa en este navegador.</small>
        </section>
      ) : stats && (
        <>
        <div className="dashboard">
          <section className="heading">
            <div><div className="eyebrow">Resumen del período</div><h1>Movimientos de tu dinero</h1><div className="period-meta"><span>Del {stats.period}</span><span>{report.movements.length} movimientos</span></div></div>
            <div className={`net ${stats.net >= 0 ? "positive" : "negative"}`}><small>Balance real del período</small><strong>{money.format(stats.net)}</strong><span>Ingresos menos egresos, sin movimientos internos</span></div>
          </section>

          <section className="cards">
            <article className="metric-card liquidated-card"><span>Liquidaciones recibidas</span><strong>{money.format(stats.liquidated)}</strong><small>Dinero liberado por tus ventas</small></article>
            <article className="metric-card income-card"><span>Total que ingresó</span><strong>{money.format(stats.income)}</strong><small>Ventas, transferencias y otros ingresos reales</small></article>
            <article className="metric-card expense-card"><span>Total que salió</span><strong>{money.format(stats.expense)}</strong><small>Pagos, servicios y transferencias reales</small></article>
            <article className="metric-card reserve-card"><span>Movimientos entre reservas</span><strong>{money.format(stats.excluded)}</strong><small>No modifican el resultado del negocio</small></article>
          </section>

          <section className="insights">
            <article className="panel">
              <div className="panel-title"><div><span>Principales salidas</span><h2>¿A dónde fue el dinero?</h2></div><small>Top 5</small></div>
              <div className="bars">
                {stats.top.map(([name, value]) => <div className="bar-row" key={name}><div><span>{name}</span><strong>{money.format(value.amount)}</strong></div><div className="track"><i style={{width: `${Math.max(4, value.amount / stats.top[0][1].amount * 100)}%`}} /></div><small>{value.count} {value.count === 1 ? "movimiento" : "movimientos"}</small></div>)}
              </div>
            </article>
            <article className="panel explanation">
              <span>Lectura rápida</span>
              <h2>{stats.net >= 0 ? "El período terminó con flujo positivo." : "Salió más dinero del que entró."}</h2>
              <p>Se liquidaron <b>{money.format(stats.liquidated)}</b>. Luego de contar ingresos y egresos externos, el resultado fue <b>{money.format(stats.net)}</b>.</p>
              <div className="rule"><span>Excluido del cálculo</span><strong>{money.format(stats.excluded)}</strong><small>Movimientos internos que no son ganancias ni gastos.</small></div>
            </article>
          </section>

          <section className="panel summary">
            <div className="panel-title"><div><span>Resumen por tipo</span><h2>Qué compone el movimiento del período</h2></div><small>{stats.breakdown.length} grupos</small></div>
            <div className="summary-list">
              {stats.breakdown.map((group) => (
                <button type="button" className="summary-row" key={group.category} onClick={() => setActiveCategory(group.category)}>
                  <div className={`summary-icon ${group.total < 0 ? "out" : "in"}`}>{group.excluded ? "—" : group.total < 0 ? "↓" : "↑"}</div>
                  <div className="summary-name"><strong>{group.category}</strong><small>{group.count} {group.count === 1 ? "movimiento" : "movimientos"}{group.excluded ? " · excluidos del resultado" : ""}</small></div>
                  <strong className={group.excluded ? "amount-neutral" : group.total >= 0 ? "amount-in" : "amount-out"}>{group.total >= 0 ? "+" : "-"}{money.format(Math.abs(group.total))}</strong>
                  <span className="summary-open">Ver detalle →</span>
                </button>
              ))}
            </div>
          </section>

          <section className="panel movements">
            <div className="panel-title"><div><span>Detalle completo</span><h2>Todos los movimientos</h2></div><strong>{rows.length} resultados</strong></div>
            <div className="filters">
              <div className="tabs"><button className={flow === "all" ? "active" : ""} onClick={() => setFlow("all")}>Todos</button><button className={flow === "income" ? "active" : ""} onClick={() => setFlow("income")}>Ingresos</button><button className={flow === "expense" ? "active" : ""} onClick={() => setFlow("expense")}>Egresos</button></div>
              <input aria-label="Buscar movimientos" placeholder="Buscar concepto o persona" value={query} onChange={(e) => setQuery(e.target.value)} />
              <select aria-label="Ordenar movimientos" value={sort} onChange={(e) => setSort(e.target.value as "asc" | "desc")}><option value="desc">Mayor a menor</option><option value="asc">Menor a mayor</option></select>
            </div>
            <div className="table-wrap"><table><thead><tr><th>Fecha</th><th>Movimiento</th><th>Categoría</th><th>Estado</th><th>Importe</th></tr></thead><tbody>{visibleRows.map((m) => <tr key={`${m.id}-${m.amount}`}><td>{m.date}</td><td><strong>{m.description}</strong><small>ID {m.id}</small></td><td><span className="tag">{m.category}</span></td><td>{m.excluded ? <span className="excluded">No impacta</span> : <span className="included">Incluido</span>}</td><td className={m.amount >= 0 ? "amount-in" : "amount-out"}>{m.amount >= 0 ? "+" : "-"}{money.format(Math.abs(m.amount))}</td></tr>)}</tbody></table></div>
            {rows.length > 10 && <div className="show-more"><button onClick={() => setExpanded((value) => !value)}>{expanded ? "Ver menos" : `Ver más (${rows.length - 10})`}<span>{expanded ? "↑" : "↓"}</span></button></div>}
          </section>
        </div>
        {activeCategory && (
          <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setActiveCategory(null); }}>
            <section className="detail-modal" role="dialog" aria-modal="true" aria-labelledby="detail-title">
              <header className="modal-header">
                <div><span>Detalle de categoría</span><h2 id="detail-title">{activeCategory}</h2></div>
                <button type="button" className="modal-close" aria-label="Cerrar" onClick={() => setActiveCategory(null)}>×</button>
              </header>

              <div className="modal-kpis">
                <article><small>Total neto</small><strong>{money.format(modalMovements.reduce((sum, movement) => sum + movement.amount, 0))}</strong></article>
                <article><small>Movimientos</small><strong>{modalMovements.length}</strong></article>
                <article><small>Promedio</small><strong>{money.format(modalMovements.length ? modalMovements.reduce((sum, movement) => sum + Math.abs(movement.amount), 0) / modalMovements.length : 0)}</strong></article>
              </div>

              {activeCategory === "Reserva SJ" && (
                <div className="reserve-purpose">
                  <div><span>Objetivo de fin de mes</span><strong>{money.format(reserveSJBalance)} de {money.format(reserveSJTarget)}</strong><small>Dinero apartado para transferir al terminar el mes.</small></div>
                  <div className="goal-track"><i style={{ width: `${Math.min(100, reserveSJBalance / reserveSJTarget * 100)}%` }} /></div>
                  <b>{Math.round(reserveSJBalance / reserveSJTarget * 100)}% completado</b>
                </div>
              )}

              {activeCategory === "Reserva publicidad e impuestos" && (
                <div className="reserve-purpose taxes-purpose">
                  <div><span>Destino de esta reserva</span><strong>Publicidad y percepciones de Mercado Libre</strong><small>Apartar o retirar estos fondos no impacta el resultado. El gasto se reconoce cuando efectivamente se paga.</small></div>
                </div>
              )}

              {activeCategory === "Reserva stock" && (
                <div className="reserve-purpose stock-purpose">
                  <div><span>Destino de esta reserva</span><strong>Compra y reposición de stock</strong><small>El movimiento interno queda excluido hasta que el dinero se utilice realmente.</small></div>
                </div>
              )}

              {activeCategory === "Liquidaciones" && (
                <div className="settlement-detail">
                  <div className="modal-section-title"><div><span>Composición comercial</span><h3>Productos, envíos y ajustes</h3></div></div>
                  {!settlementReport ? (
                    <div className="settlement-upload">
                      <div><strong>El estado de cuenta no incluye este desglose.</strong><p>Cargá también el CSV de liquidaciones para separar productos, envíos, descuentos, impuestos y reclamos.</p></div>
                      <label className="upload compact">Cargar liquidaciones<input type="file" accept=".csv" onChange={uploadSettlement} /></label>
                      {settlementError && <small className="error">{settlementError}</small>}
                    </div>
                  ) : (
                    <>
                      <div className="settlement-source"><span>{settlementReport.name}</span><label>Cambiar archivo<input type="file" accept=".csv" onChange={uploadSettlement} /></label></div>
                      <div className="settlement-grid">
                        {settlementBreakdown.map((group) => (
                          <article key={group.label}><span>{group.label}</span><strong className={group.net >= 0 ? "amount-in" : "amount-out"}>{money.format(group.net)}</strong><small>{group.count} operaciones · Bruto {money.format(group.gross)}</small><small>Descuentos {money.format(Math.abs(group.fees))} · Impuestos {money.format(Math.abs(group.taxes))}</small></article>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              <div className="modal-section-title"><div><span>Principales conceptos</span><h3>{activeCategory.includes("Transferencias") ? "Personas y destinatarios" : "Movimientos agrupados"}</h3></div></div>
              <div className="modal-groups">
                {modalGroups.slice(0, 8).map(([name, value]) => (
                  <div key={name}><span>{name}</span><small>{value.count} {value.count === 1 ? "operación" : "operaciones"}</small><strong className={value.total >= 0 ? "amount-in" : "amount-out"}>{value.total >= 0 ? "+" : "-"}{money.format(Math.abs(value.total))}</strong></div>
                ))}
              </div>

              <div className="modal-section-title"><div><span>Operación por operación</span><h3>Detalle completo</h3></div></div>
              <div className="modal-table"><table><thead><tr><th>Fecha</th><th>Descripción</th><th>Importe</th></tr></thead><tbody>{modalMovements.map((movement) => <tr key={`${movement.id}-modal`}><td>{movement.date}</td><td>{movement.description}</td><td className={movement.amount >= 0 ? "amount-in" : "amount-out"}>{movement.amount >= 0 ? "+" : "-"}{money.format(Math.abs(movement.amount))}</td></tr>)}</tbody></table></div>
            </section>
          </div>
        )}
        </>
      )}
    </main>
  );
}
