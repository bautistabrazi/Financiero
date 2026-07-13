"use client";

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

const money = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

function parseMoney(value = "0") {
  return Number(value.replace(/\./g, "").replace(",", ".")) || 0;
}

function classify(description: string) {
  const text = description.toLocaleLowerCase("es");
  if (text.includes("reserva programada") || text.includes("dinero reservado") || text.includes("dinero retirado"))
    return { category: "Reservas", excluded: true };
  if (text.includes("transferencia enviada bautista brazi") || text.includes("transferencia recibida bautista brazi"))
    return { category: "Movimiento propio", excluded: true };
  if (text.includes("liquidación de dinero")) return { category: "Liquidaciones", excluded: false };
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

export default function Home() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [flow, setFlow] = useState<"all" | "income" | "expense">("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"desc" | "asc">("desc");

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setReport(parseReport(await file.text(), file.name));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos leer el archivo.");
    }
  }

  const stats = useMemo(() => {
    if (!report) return null;
    const included = report.movements.filter((m) => !m.excluded);
    const income = included.filter((m) => m.amount > 0).reduce((sum, m) => sum + m.amount, 0);
    const expense = included.filter((m) => m.amount < 0).reduce((sum, m) => sum + Math.abs(m.amount), 0);
    const liquidated = report.movements.filter((m) => m.category === "Liquidaciones").reduce((sum, m) => sum + m.amount, 0);
    const excluded = report.movements.filter((m) => m.excluded).reduce((sum, m) => sum + Math.abs(m.amount), 0);
    const groups = new Map<string, { amount: number; count: number }>();
    included.filter((m) => m.amount < 0).forEach((m) => {
      const key = counterpart(m);
      const current = groups.get(key) ?? { amount: 0, count: 0 };
      groups.set(key, { amount: current.amount + Math.abs(m.amount), count: current.count + 1 });
    });
    const top = [...groups.entries()].sort((a, b) => b[1].amount - a[1].amount).slice(0, 5);
    return { income, expense, liquidated, excluded, net: income - expense, top };
  }, [report]);

  const rows = useMemo(() => {
    if (!report) return [];
    return report.movements
      .filter((m) => flow === "all" || (flow === "income" ? m.amount > 0 : m.amount < 0))
      .filter((m) => `${m.description} ${m.category}`.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => sort === "desc" ? Math.abs(b.amount) - Math.abs(a.amount) : Math.abs(a.amount) - Math.abs(b.amount));
  }, [report, flow, query, sort]);

  return (
    <main>
      <header className="topbar">
        <div className="brand"><span>F</span><strong>Flujo claro</strong></div>
        {report && <label className="upload compact">Actualizar CSV<input type="file" accept=".csv" onChange={upload} /></label>}
      </header>

      {!report ? (
        <section className="welcome">
          <div className="eyebrow">Tu dinero, explicado con claridad</div>
          <h1>Entendé qué generó tu negocio y a dónde fue el dinero.</h1>
          <p>Cargá el estado de cuenta de Mercado Pago. Las reservas y movimientos propios se separan automáticamente para no distorsionar el resultado.</p>
          <label className="upload">Elegir reporte CSV<input type="file" accept=".csv" onChange={upload} /></label>
          {error && <p className="error">{error}</p>}
          <small>El archivo se procesa en este navegador.</small>
        </section>
      ) : stats && (
        <div className="dashboard">
          <section className="heading">
            <div><div className="eyebrow">Resumen del período</div><h1>Así se movió tu dinero</h1><p>{report.name} · {report.movements.length} movimientos</p></div>
            <div className={`net ${stats.net >= 0 ? "positive" : "negative"}`}><small>Flujo externo neto</small><strong>{money.format(stats.net)}</strong><span>sin reservas ni movimientos propios</span></div>
          </section>

          <section className="cards">
            <article><span>Dinero liquidado</span><strong>{money.format(stats.liquidated)}</strong><small>Ingresos por liquidaciones</small></article>
            <article><span>Ingresos externos</span><strong>{money.format(stats.income)}</strong><small>Operaciones incluidas</small></article>
            <article><span>Egresos externos</span><strong>{money.format(stats.expense)}</strong><small>Pagos y transferencias</small></article>
            <article className="muted-card"><span>Movimientos excluidos</span><strong>{money.format(stats.excluded)}</strong><small>Reservas y cuentas propias</small></article>
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

          <section className="panel movements">
            <div className="panel-title"><div><span>Detalle completo</span><h2>Todos los movimientos</h2></div><strong>{rows.length} resultados</strong></div>
            <div className="filters">
              <div className="tabs"><button className={flow === "all" ? "active" : ""} onClick={() => setFlow("all")}>Todos</button><button className={flow === "income" ? "active" : ""} onClick={() => setFlow("income")}>Ingresos</button><button className={flow === "expense" ? "active" : ""} onClick={() => setFlow("expense")}>Egresos</button></div>
              <input aria-label="Buscar movimientos" placeholder="Buscar concepto o persona" value={query} onChange={(e) => setQuery(e.target.value)} />
              <select aria-label="Ordenar movimientos" value={sort} onChange={(e) => setSort(e.target.value as "asc" | "desc")}><option value="desc">Mayor a menor</option><option value="asc">Menor a mayor</option></select>
            </div>
            <div className="table-wrap"><table><thead><tr><th>Fecha</th><th>Movimiento</th><th>Categoría</th><th>Estado</th><th>Importe</th></tr></thead><tbody>{rows.map((m) => <tr key={`${m.id}-${m.amount}`}><td>{m.date}</td><td><strong>{m.description}</strong><small>ID {m.id}</small></td><td><span className="tag">{m.category}</span></td><td>{m.excluded ? <span className="excluded">No impacta</span> : <span className="included">Incluido</span>}</td><td className={m.amount >= 0 ? "amount-in" : "amount-out"}>{m.amount >= 0 ? "+" : "-"}{money.format(Math.abs(m.amount))}</td></tr>)}</tbody></table></div>
          </section>
        </div>
      )}
    </main>
  );
}
