// Simple Investor Portfolio - Frontend logic
// Stores data in localStorage, renders three tabs: ETFs, Purchases, Dashboard

(function () {
	const LS_KEYS = {
		etfs: 'sip_etfs',
		purchases: 'sip_purchases',
		goals: 'sip_goals',
		ui: 'sip_ui'
	};

	// ---------- Utilities ----------
	const $ = (sel, root = document) => root.querySelector(sel);
	const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
	const fmtCurrency = (n) => `€${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
	const fmtDate = (ts) => new Date(ts).toLocaleString();
	const nowLocalDatetime = () => {
		const d = new Date();
		d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
		return d.toISOString().slice(0, 16);
	};
	const parseLocalDatetime = (val) => {
		if (!val) return Date.now();
		// Treat input as local and convert to UTC timestamp
		const d = new Date(val);
		return d.getTime();
	};

	const storage = {
		get(key, fallback) {
			try {
				const raw = localStorage.getItem(key);
				return raw ? JSON.parse(raw) : fallback;
			} catch (_) {
				return fallback;
			}
		},
		set(key, val) {
			localStorage.setItem(key, JSON.stringify(val));
		},
	};

	// ---------- State ----------
	let etfs = storage.get(LS_KEYS.etfs, []); // [{symbol, name, prices:[{ts, price}]}]
	let purchases = storage.get(LS_KEYS.purchases, []); // [{ts, symbol, qty}]
	// Goals are dynamic: array of {id, name, target, monthly}
	let goals = storage.get(LS_KEYS.goals, []);
	if (!Array.isArray(goals)) goals = [];
	let ui = storage.get(LS_KEYS.ui, { active: 'etfs', expandedEtfs: [] });
	if (!Array.isArray(ui.expandedEtfs)) ui.expandedEtfs = [];

	function reloadState() {
		etfs = storage.get(LS_KEYS.etfs, []);
		purchases = storage.get(LS_KEYS.purchases, []);
		goals = storage.get(LS_KEYS.goals, []);
		if (!Array.isArray(goals)) goals = [];
		ui = storage.get(LS_KEYS.ui, { active: 'etfs', expandedEtfs: [] });
		if (!Array.isArray(ui.expandedEtfs)) ui.expandedEtfs = [];
	}

	const saveEtfs = () => storage.set(LS_KEYS.etfs, etfs);
	const savePurchases = () => storage.set(LS_KEYS.purchases, purchases);
	const saveGoals = () => storage.set(LS_KEYS.goals, goals);
	const saveUi = () => storage.set(LS_KEYS.ui, ui);

		// ---------- Export / Import / Reset ----------
		function exportAll() {
			const data = {
				$schema: 'simple-investor-portfolio.v1',
				exportedAt: new Date().toISOString(),
				etfs,
				purchases,
				goals,
				ui,
			};
			const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `portfolio-export-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
			document.body.appendChild(a);
			a.click();
			a.remove();
			URL.revokeObjectURL(url);
		}

			function importAll(file) {
			const reader = new FileReader();
			reader.onload = () => {
				try {
					const data = JSON.parse(reader.result);
					if (!data || typeof data !== 'object') throw new Error('Invalid file');
					if (!Array.isArray(data.etfs) || !Array.isArray(data.purchases)) throw new Error('Invalid content');
					etfs = data.etfs || [];
					purchases = data.purchases || [];
								goals = Array.isArray(data.goals) ? data.goals : [];
					ui = data.ui || ui;
					if (!Array.isArray(ui.expandedEtfs)) ui.expandedEtfs = [];
					saveEtfs(); savePurchases(); saveGoals(); saveUi();
					// re-render
					refreshPurchaseSymbols();
					setActiveTab(ui.active || 'etfs');
					alert('Імпорт виконано успішно');
				} catch (err) {
					console.error(err);
					alert('Не вдалося імпортувати файл. Перевірте формат.');
				}
			};
			reader.readAsText(file);
		}

			function resetAll() {
			if (!confirm('Скинути всі дані? Це дію не можна відмінити.')) return;
			etfs = [];
			purchases = [];
			goals = [];
			ui = { active: 'etfs', expandedEtfs: [] };
			saveEtfs(); savePurchases(); saveGoals(); saveUi();
			refreshPurchaseSymbols();
			setActiveTab('etfs');
		}

	// ---------- Price lookup ----------
	function latestPrice(symbol) {
		const e = etfs.find((x) => x.symbol === symbol);
		if (!e || !e.prices?.length) return null;
		return e.prices.reduce((a, b) => (a.ts > b.ts ? a : b)).price;
	}

	function priceAt(symbol, ts) {
		const e = etfs.find((x) => x.symbol === symbol);
		if (!e || !e.prices?.length) return null;
		// Best price is the most recent snapshot at or before ts; fallback to closest overall
		const sorted = [...e.prices].sort((a, b) => a.ts - b.ts);
		let candidate = null;
		for (const p of sorted) {
			if (p.ts <= ts) candidate = p; else break;
		}
		if (candidate) return candidate.price;
		// fallback closest
		let closest = sorted[0];
		let minDiff = Math.abs(sorted[0].ts - ts);
		for (const p of sorted) {
			const diff = Math.abs(p.ts - ts);
			if (diff < minDiff) { minDiff = diff; closest = p; }
		}
		return closest?.price ?? null;
	}

	// ---------- Calculations ----------
	function computeTotals() {
		let invested = 0;
		let current = 0;
		for (const p of purchases) {
			const unitAtBuy = priceAt(p.symbol, p.ts);
			const unitNow = latestPrice(p.symbol);
			if (unitAtBuy != null) invested += p.qty * unitAtBuy;
			if (unitNow != null) current += p.qty * unitNow;
		}
		const pl = current - invested;
		const plPct = invested > 0 ? (pl / invested) * 100 : 0;
		return { invested, current, pl, plPct };
	}

			function monthsToReach(target, monthly) {
				const t = +target || 0;
				const m = +monthly || 0;
				if (m <= 0) return Infinity;
				const remaining = Math.max(0, t);
				return Math.ceil(remaining / m);
			}

	function ymFromMonths(m) {
		if (!isFinite(m)) return { y: '∞', m: '' };
		const y = Math.floor(m / 12);
		const mm = m % 12;
		return { y, m: mm };
	}

	// ---------- Rendering ----------
	function setActiveTab(tab) {
		ui.active = tab; saveUi();
		$$(".tab-section").forEach((el) => el.classList.add('hidden'));
		$(`#tab-${tab}`)?.classList.remove('hidden');
		$$(".tab-btn").forEach((btn) => {
			const isActive = btn.dataset.tab === tab;
			btn.classList.toggle('bg-slate-900', isActive);
			btn.classList.toggle('text-white', isActive);
			btn.classList.toggle('dark:bg-white', isActive);
			btn.classList.toggle('dark:text-slate-900', isActive);
		});
		if (tab === 'etfs') renderEtfs();
		if (tab === 'purchases') renderPurchases();
			if (tab === 'dashboard') renderDashboard();
	}

		function renderEtfs() {
		// Fill add form defaults
		const form = $('#form-add-etf');
		form.onsubmit = (e) => {
			e.preventDefault();
			const symbol = $('#etf-symbol').value.trim().toUpperCase();
			const name = $('#etf-name').value.trim();
			if (!symbol || !name) return;
			if (etfs.some((x) => x.symbol === symbol)) {
				alert('Такий символ вже існує');
				return;
			}
			etfs.push({ symbol, name, prices: [] });
			saveEtfs();
			$('#etf-symbol').value = '';
			$('#etf-name').value = '';
			renderEtfs();
			refreshPurchaseSymbols();
		};

		const list = $('#etf-list');
		list.innerHTML = '';
		const tpl = $('#tpl-etf-item');
			etfs
			.sort((a, b) => a.symbol.localeCompare(b.symbol))
			.forEach((e) => {
				const node = tpl.content.cloneNode(true);
				const root = node.firstElementChild;
				$('[data-field="symbol"]', root).textContent = e.symbol;
				$('[data-field="name"]', root).textContent = e.name;
				$('[data-field="pricesCount"]', root).textContent = e.prices?.length || 0;

								const details = $('[data-role="details"]', root);
								const toggleBtn = $('[data-action="toggle"]', root);
						const isExpanded = ui.expandedEtfs.includes(e.symbol);
						if (isExpanded) {
							details.classList.remove('hidden');
									toggleBtn.textContent = '⬆️';
						} else {
							details.classList.add('hidden');
									toggleBtn.textContent = '⬇️';
						}
						toggleBtn.onclick = () => {
							const idx = ui.expandedEtfs.indexOf(e.symbol);
							if (idx === -1) ui.expandedEtfs.push(e.symbol); else ui.expandedEtfs.splice(idx, 1);
							saveUi();
							// update UI without full re-render
							const nowExpanded = ui.expandedEtfs.includes(e.symbol);
							details.classList.toggle('hidden', !nowExpanded);
									toggleBtn.textContent = nowExpanded ? '⬆️' : '⬇️';
						};

						$('[data-action="delete"]', root).onclick = () => {
					if (!confirm(`Видалити ETF ${e.symbol}? Будуть також приховані покупки з цим символом (не видалятимуться).`)) return;
							etfs = etfs.filter((x) => x.symbol !== e.symbol);
							// Remove from expanded state
							ui.expandedEtfs = ui.expandedEtfs.filter((s) => s !== e.symbol);
							saveUi();
					saveEtfs();
					renderEtfs();
					refreshPurchaseSymbols();
				};

				// Render prices
						const pricesWrap = $('[data-role="prices"]', details);
						pricesWrap.innerHTML = '';
						const tableTpl = $('#tpl-price-table');
						const trTpl = $('#tpl-price-tr');
						const tableNode = tableTpl.content.cloneNode(true);
						const tbody = $('[data-role="rows"]', tableNode);

						const fromEl = $('[data-filter="from"]', tableNode);
						const toEl = $('[data-filter="to"]', tableNode);
						const sortEl = $('[data-filter="sort"]', tableNode);

						function renderPriceRows() {
							tbody.innerHTML = '';
							let arr = [...(e.prices || [])];
							const from = fromEl.value ? new Date(fromEl.value).getTime() : null;
							const to = toEl.value ? new Date(toEl.value).getTime() + 24*3600*1000 - 1 : null;
							if (from != null) arr = arr.filter(p => p.ts >= from);
							if (to != null) arr = arr.filter(p => p.ts <= to);
							arr.sort((a, b) => sortEl.value === 'asc' ? a.ts - b.ts : b.ts - a.ts);
							arr.forEach((p) => {
								const row = trTpl.content.cloneNode(true);
								$('[data-field="date"]', row).textContent = fmtDate(p.ts);
								$('[data-field="price"]', row).textContent = fmtCurrency(p.price);
								$('[data-action="remove"]', row).onclick = () => {
									e.prices.splice(e.prices.indexOf(p), 1);
									saveEtfs();
									renderEtfs();
								};
								$('[data-action="edit"]', row).onclick = () => {
									// Simple inline edit via prompts for now
									const newTsStr = prompt('Нова дата/час (YYYY-MM-DD HH:MM):', new Date(p.ts).toISOString().slice(0,16).replace('T',' '));
									const newPriceStr = prompt('Нова ціна (€):', String(p.price));
									if (!newTsStr || !newPriceStr) return;
									const iso = newTsStr.replace(' ', 'T');
									const newTs = new Date(iso).getTime();
									const newPrice = parseFloat(newPriceStr);
									if (!isFinite(newTs) || !isFinite(newPrice)) return;
									p.ts = newTs; p.price = newPrice;
									e.prices.sort((a, b) => a.ts - b.ts);
									saveEtfs();
									renderEtfs();
								};
								tbody.appendChild(row);
							});
						}
						fromEl.onchange = renderPriceRows;
						toEl.onchange = renderPriceRows;
						sortEl.onchange = renderPriceRows;
						renderPriceRows();
						pricesWrap.appendChild(tableNode);

				// Add price form
				const addPriceForm = $('[data-role="add-price"]', details);
				$('[data-input="ts"]', addPriceForm).value = nowLocalDatetime();
						addPriceForm.onsubmit = (ev) => {
					ev.preventDefault();
					const tsVal = $('[data-input="ts"]', addPriceForm).value;
					const priceVal = parseFloat($('[data-input="price"]', addPriceForm).value);
					if (!isFinite(priceVal) || priceVal < 0) return;
					e.prices = e.prices || [];
					e.prices.push({ ts: parseLocalDatetime(tsVal), price: priceVal });
					e.prices.sort((a, b) => a.ts - b.ts);
					saveEtfs();
							// re-render to refresh counts and lists but keep expansion via ui.expandedEtfs
							renderEtfs();
				};

				list.appendChild(node);
			});
			// refresh ETF chart controls (symbols)
			buildEtfChartControls();
	}

	function refreshPurchaseSymbols() {
		const select = $('#purchase-symbol');
		if (!select) return;
		const prev = select.value;
		select.innerHTML = '';
		etfs
			.slice()
			.sort((a, b) => a.symbol.localeCompare(b.symbol))
			.forEach((e) => {
				const opt = document.createElement('option');
				opt.value = e.symbol; opt.textContent = `${e.symbol} — ${e.name}`;
				select.appendChild(opt);
			});
		if (prev) select.value = prev;
	}

	function renderPurchases() {
		// Refresh symbol select and default timestamp
		refreshPurchaseSymbols();
		$('#purchase-ts').value = nowLocalDatetime();

		// Form elements
		const form = $('#form-add-purchase');
		const symbolEl = $('#purchase-symbol');
		const tsEl = $('#purchase-ts');
		const qtyEl = $('#purchase-qty');
		const sumEl = $('#purchase-sum');
		const unitEl = $('#purchase-unit');

		let lastEdited = 'qty'; // 'qty' | 'sum'

		function currentUnit() {
			const symbol = symbolEl.value;
			const ts = parseLocalDatetime(tsEl.value);
			const unit = priceAt(symbol, ts);
			unitEl.textContent = unit != null ? fmtCurrency(unit) : '—';
			return unit;
		}

		function recalcFromQty() {
			const unit = currentUnit();
			const qty = parseFloat(qtyEl.value);
			if (unit != null && isFinite(qty) && qty >= 0) sumEl.value = (qty * unit).toFixed(2);
		}

		function recalcFromSum() {
			const unit = currentUnit();
			const sum = parseFloat(sumEl.value);
			if (unit != null && isFinite(sum) && sum >= 0) qtyEl.value = (sum / unit).toFixed(4);
		}

		// Bind inputs
		currentUnit();
		symbolEl.onchange = () => { currentUnit(); (lastEdited === 'qty' ? recalcFromQty : recalcFromSum)(); };
		tsEl.onchange = () => { currentUnit(); (lastEdited === 'qty' ? recalcFromQty : recalcFromSum)(); };
		qtyEl.oninput = () => { lastEdited = 'qty'; recalcFromQty(); };
		sumEl.oninput = () => { lastEdited = 'sum'; recalcFromSum(); };

		function bindArrowStepWhole(el, decimals) {
			el.addEventListener('keydown', (ev) => {
				if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
				ev.preventDefault();
				const cur = parseFloat(el.value || '0') || 0;
				const delta = ev.key === 'ArrowUp' ? 1 : -1;
				const next = cur + delta;
				el.value = next.toFixed(decimals);
				el.dispatchEvent(new Event('input'));
			});
		}
		bindArrowStepWhole(qtyEl, 4);
		bindArrowStepWhole(sumEl, 2);

		form.onsubmit = (e) => {
			e.preventDefault();
			const symbol = symbolEl.value;
			const ts = parseLocalDatetime(tsEl.value);
			let qty = parseFloat(qtyEl.value);
			const sum = parseFloat(sumEl.value);
			if ((!isFinite(qty) || qty <= 0) && isFinite(sum) && sum > 0) {
				const unit = priceAt(symbol, ts);
				if (unit == null || unit <= 0) { alert('Немає ціни на цю дату для обчислення кількості.'); return; }
				qty = sum / unit;
			}
			if (!symbol || !isFinite(qty) || qty <= 0) return;
			purchases.push({ symbol, ts, qty });
			savePurchases();
			qtyEl.value = '';
			sumEl.value = '';
			renderPurchases();
		};

		// Purchase list/table with filters
		const container = $('#purchase-list');
		const listTpl = $('#tpl-purchase-list');
		container.innerHTML = '';
		const node = listTpl.content.cloneNode(true);
		const rows = $('[data-role="rows"]', node);
		const fSymbol = $('[data-filter="symbol"]', node);
		const fFrom = $('[data-filter="from"]', node);
		const fTo = $('[data-filter="to"]', node);
		const fSort = $('[data-filter="sort"]', node);

		// Fill symbol filter for table
		fSymbol.innerHTML = '';
		const allOpt = document.createElement('option'); allOpt.value = ''; allOpt.textContent = 'Всі';
		fSymbol.appendChild(allOpt);
		etfs.slice().sort((a,b)=>a.symbol.localeCompare(b.symbol)).forEach(e => {
			const opt = document.createElement('option'); opt.value = e.symbol; opt.textContent = e.symbol; fSymbol.appendChild(opt);
		});

		function renderRows() {
			rows.innerHTML = '';
			let arr = purchases.slice();
			if (fSymbol.value) arr = arr.filter(p => p.symbol === fSymbol.value);
			const from = fFrom.value ? new Date(fFrom.value).getTime() : null;
			const to = fTo.value ? new Date(fTo.value).getTime() + 24*3600*1000 - 1 : null;
			if (from != null) arr = arr.filter(p => p.ts >= from);
			if (to != null) arr = arr.filter(p => p.ts <= to);
			arr.sort((a, b) => fSort.value === 'asc' ? a.ts - b.ts : b.ts - a.ts);
			arr.forEach((p) => {
				const rowTpl = $('#tpl-purchase-row');
				const row = rowTpl.content.cloneNode(true);
				$('[data-field="date"]', row).textContent = fmtDate(p.ts);
				$('[data-field="symbol"]', row).textContent = p.symbol;
				$('[data-field="qty"]', row).textContent = p.qty;
				const unit = priceAt(p.symbol, p.ts);
				const sum = unit != null ? p.qty * unit : null;
				$('[data-field="unit"]', row).textContent = unit != null ? fmtCurrency(unit) : '—';
				$('[data-field="sum"]', row).textContent = sum != null ? fmtCurrency(sum) : '—';
				$('[data-action="remove"]', row).onclick = () => {
					const i = purchases.indexOf(p);
					if (i >= 0) purchases.splice(i, 1);
					savePurchases();
					renderPurchases();
				};
				rows.appendChild(row);
			});
		}

		[fSymbol, fFrom, fTo, fSort].forEach(el => el.addEventListener('change', renderRows));
		container.appendChild(node);
		renderRows();

		// Purchases chart (multi-symbol stacked bars)
		let purchasesChart;
		function renderPurchasesChart() {
			const ctx = document.getElementById('purchases-chart');
			if (!ctx) return;
			if (purchasesChart) { purchasesChart.destroy(); purchasesChart = null; }
			try { Chart.getChart(ctx)?.destroy(); } catch (_) {}

			const selected = Array.from($$('#purchases-chart-symbols input:checked')).map(i=>i.value);
			const cf = $('#purchases-chart-from')?.value ? new Date($('#purchases-chart-from').value).getTime() : null;
			const ct = $('#purchases-chart-to')?.value ? new Date($('#purchases-chart-to').value).getTime() + 24*3600*1000 - 1 : null;

			const datasets = selected.map((sym, idx) => {
				const byDay = new Map();
				purchases.forEach(p => {
					if (p.symbol !== sym) return;
					if (cf!=null && p.ts < cf) return;
					if (ct!=null && p.ts > ct) return;
					const unit = priceAt(p.symbol, p.ts);
					if (unit == null) return;
					const sum = p.qty * unit;
					const day = new Date(new Date(p.ts).toDateString()).getTime();
					byDay.set(day, (byDay.get(day) || 0) + sum);
				});
				const points = Array.from(byDay.entries()).sort((a,b)=>a[0]-b[0]).map(([x,y])=>({x, y}));
				return { label: sym, data: points, backgroundColor: `hsl(${(idx*60)%360} 70% 60%)` };
			});

			purchasesChart = new Chart(ctx, {
				type: 'bar',
				data: { datasets },
				options: { parsing: false, scales: { x: { type:'linear', stacked: true, ticks:{ callback:(v)=> new Date(v).toLocaleDateString() } }, y: { stacked: true, title:{display:true, text:'€'} } }, plugins:{ legend:{display:true} } }
			});
		}

		function buildPurchasesChartControls(){
			const box = $('#purchases-chart-symbols');
			if (!box) return;
			const prev = new Set(Array.from($$('#purchases-chart-symbols input:checked')).map(i=>i.value));
			box.innerHTML = '';
			etfs.slice().sort((a,b)=>a.symbol.localeCompare(b.symbol)).forEach((e,i)=>{
				const id = `purch-cb-${i}`;
				const label = document.createElement('label');
				label.className = 'inline-flex items-center gap-1 text-sm';
				const checked = prev.size ? prev.has(e.symbol) : true;
				label.innerHTML = `<input id="${id}" type="checkbox" value="${e.symbol}" class="rounded" ${checked?'checked':''}> ${e.symbol}`;
				box.appendChild(label);
			});
			$('#purchases-chart-from')?.addEventListener('change', renderPurchasesChart);
			$('#purchases-chart-to')?.addEventListener('change', renderPurchasesChart);
			box.addEventListener('change', renderPurchasesChart);
			renderPurchasesChart();
		}

		buildPurchasesChartControls();
	}

		// Build ETF chart datasets
		let etfChart;
		function renderEtfChart() {
			const ctx = document.getElementById('etf-chart');
			if (!ctx) return;
			if (etfChart) { etfChart.destroy(); etfChart = null; }
			const fromEl = $('#etf-chart-from');
			const toEl = $('#etf-chart-to');
			const from = fromEl?.value ? new Date(fromEl.value).getTime() : null;
			const to = toEl?.value ? new Date(toEl.value).getTime() + 24*3600*1000 - 1 : null;
			const symbols = Array.from($$('#etf-chart-symbols input:checked')).map(i=>i.value);
			const datasets = symbols.map((sym, idx) => {
				const e = etfs.find(x=>x.symbol===sym);
				let data = (e?.prices||[]).slice();
				if (from!=null) data = data.filter(p=>p.ts>=from);
				if (to!=null) data = data.filter(p=>p.ts<=to);
				data.sort((a,b)=>a.ts-b.ts);
				return {
					label: sym,
					data: data.map(p=>({ x: p.ts, y: p.price })),
					borderColor: `hsl(${(idx*60)%360} 70% 50%)`,
					tension: 0.2,
				};
			});
				// Extra safety: ensure any existing chart bound to this canvas is destroyed
				try { Chart.getChart(ctx)?.destroy(); } catch (_) {}
				etfChart = new Chart(ctx, {
				type: 'line',
				data: { datasets },
				options: {
					parsing: false,
						scales: {
							x: { type: 'linear', ticks: { callback: (v) => new Date(v).toLocaleDateString() } },
							y: { title: { display: true, text: '€' } }
						},
					plugins: { legend: { display: true } }
				}
			});
		}

		// Portfolio chart
			let portfolioChart;
			function renderPortfolioChart() {
			const ctx = document.getElementById('portfolio-chart');
			if (!ctx) return;
			if (portfolioChart) { portfolioChart.destroy(); portfolioChart = null; }
			// Extra safety: ensure any existing chart bound to this canvas is destroyed
			try { Chart.getChart(ctx)?.destroy(); } catch (_) {}
			const fromEl = $('#portfolio-from');
			const toEl = $('#portfolio-to');
			const from = fromEl?.value ? new Date(fromEl.value).getTime() : null;
			const to = toEl?.value ? new Date(toEl.value).getTime() + 24*3600*1000 - 1 : null;

			// Build timeline from all unique price timestamps
			const times = new Set();
			etfs.forEach(e => (e.prices||[]).forEach(p => times.add(p.ts)));
			purchases.forEach(p => times.add(p.ts));
			let points = Array.from(times).map(Number).sort((a,b)=>a-b);
			if (from!=null) points = points.filter(t=>t>=from);
			if (to!=null) points = points.filter(t=>t<=to);
				const seriesCurrent = points.map(t => {
				// For each time t, compute portfolio value using latest price up to t and purchases up to t
				let value = 0;
				const qtyBySymbol = {};
				purchases.filter(p=>p.ts<=t).forEach(p=>{ qtyBySymbol[p.symbol]=(qtyBySymbol[p.symbol]||0)+p.qty; });
				for (const sym of Object.keys(qtyBySymbol)) {
					const unit = priceAt(sym, t);
					if (unit!=null) value += qtyBySymbol[sym]*unit;
				}
				return { x: t, y: value };
			});
				// Invested (initial contributions) cumulative
				let investedTotal = 0;
				const seriesInvested = points.map(t => {
					purchases.filter(p=>p.ts<=t).forEach(p=>{
						const unitAtBuy = priceAt(p.symbol, p.ts);
						if (unitAtBuy!=null) investedTotal += p.qty * unitAtBuy;
					});
					return { x: t, y: investedTotal };
				});

				portfolioChart = new Chart(ctx, {
					type: 'line',
					data: { datasets: [
						{ label: 'Поточна вартість', data: seriesCurrent, borderColor: 'hsl(210 70% 50%)', tension: 0.2 },
						{ label: 'Початкові вклади', data: seriesInvested, borderColor: 'hsl(10 70% 50%)', borderDash: [6,4], tension: 0.2 },
					] },
					options: { parsing: false, plugins:{ legend:{ display:true } }, scales: { x: { type:'linear', ticks: { callback: (v)=> new Date(v).toLocaleDateString() } }, y: { title:{display:true, text:'€'} } } }
				});
		}

		function renderDashboard() {
		const { invested, current, pl, plPct } = computeTotals();
		$('#stat-invested').textContent = fmtCurrency(invested);
		$('#stat-current').textContent = fmtCurrency(current);
		const plEl = $('#stat-pl');
		plEl.textContent = `${fmtCurrency(pl)} (${plPct.toFixed(2)}%)`;
		plEl.classList.toggle('text-emerald-600', pl >= 0);
		plEl.classList.toggle('text-red-600', pl < 0);

			// Portfolio chart and ETF chart updates
			renderPortfolioChart();
			$('#portfolio-from')?.addEventListener('change', renderPortfolioChart);
			$('#portfolio-to')?.addEventListener('change', renderPortfolioChart);

			// Dynamic goals UI
					const list = $('#goals-list');
			const addBtn = $('#goal-add');
			list.innerHTML = '';
			const renderGoals = () => {
				list.innerHTML = '';
				goals.forEach((g) => {
					const card = document.createElement('div');
					card.className = 'bg-white/50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 rounded-md p-4';
					card.innerHTML = `
						<div class="flex items-center justify-between mb-3">
							<input value="${g.name}" class="px-2 py-1 rounded-md border border-slate-200 dark:border-slate-800 bg-transparent w-1/2" />
							<div class="space-x-2">
								<button data-action="remove" class="px-2 py-1 rounded-md bg-red-50 text-red-700 hover:bg-red-100" title="Видалити">🗑️</button>
							</div>
						</div>
						<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
							<label class="block text-sm">Ціль (€)
								<input data-field="target" type="number" step="1" min="0" value="${g.target}" class="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950" />
							</label>
							<label class="block text-sm">Щомісяця (€)
								<input data-field="monthly" type="number" step="1" min="0" value="${g.monthly}" class="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950" />
							</label>
						</div>
						<div class="mt-2 text-sm text-slate-600 dark:text-slate-300">Час до цілі: <span data-field="time">—</span></div>
						<div class="mt-2 text-xs text-slate-500">Порада: зміни значення — час перерахується автоматично.</div>
					`;
					const nameEl = card.querySelector('input');
					const targetEl = card.querySelector('[data-field="target"]');
					const monthlyEl = card.querySelector('[data-field="monthly"]');
					const timeEl = card.querySelector('[data-field="time"]');
											const refresh = () => {
												const targetVal = parseFloat(targetEl.value);
												const monthlyVal = parseFloat(monthlyEl.value);
												if (!isFinite(targetVal) || !isFinite(monthlyVal) || monthlyVal <= 0) {
													timeEl.textContent = 'неможливо';
													return;
												}
												const months = monthsToReach(targetVal, monthlyVal);
						const t = ymFromMonths(months);
						timeEl.textContent = isFinite(months) ? `${t.y} р. ${t.m} міс.` : 'неможливо';
					};
					const persist = () => {
										g.name = nameEl.value.trim() || g.name;
										g.target = parseFloat(targetEl.value) || 0;
										g.monthly = parseFloat(monthlyEl.value) || 0;
						saveGoals();
						refresh();
					};
					nameEl.oninput = persist; targetEl.oninput = persist; monthlyEl.oninput = persist;
					card.querySelector('[data-action="remove"]').onclick = () => {
						goals = goals.filter(x=>x!==g); saveGoals(); renderGoals();
					};
					refresh();
					list.appendChild(card);
				});
			};
			addBtn.onclick = () => {
				const id = `goal_${Date.now()}`;
				goals.push({ id, name: 'Нова мета', target: 0, monthly: 0 });
				saveGoals();
				renderGoals();
			};
			renderGoals();
	}

	// ---------- Init ----------
		function buildEtfChartControls() {
			const box = $('#etf-chart-symbols');
			if (!box) return;
			const prevSelected = new Set(Array.from($$('#etf-chart-symbols input:checked')).map(i=>i.value));
			box.innerHTML = '';
			etfs.slice().sort((a,b)=>a.symbol.localeCompare(b.symbol)).forEach((e,i)=>{
				const id = `etf-cb-${i}`;
				const label = document.createElement('label');
				label.className = 'inline-flex items-center gap-1 text-sm';
				const checked = prevSelected.size ? prevSelected.has(e.symbol) : true;
				label.innerHTML = `<input id="${id}" type="checkbox" value="${e.symbol}" class="rounded" ${checked?'checked':''}> ${e.symbol}`;
				box.appendChild(label);
			});
			$('#etf-chart-from')?.addEventListener('change', renderEtfChart);
			$('#etf-chart-to')?.addEventListener('change', renderEtfChart);
			box.addEventListener('change', renderEtfChart);
			renderEtfChart();
		}

		function initTabs() {
			$$(".tab-btn").forEach((btn) => {
			btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
		});
			// Header actions
			$('#btn-export')?.addEventListener('click', exportAll);
			$('#btn-import')?.addEventListener('click', () => $('#file-import').click());
			$('#file-import')?.addEventListener('change', (e) => {
				const file = e.target.files?.[0];
				if (file) importAll(file);
				e.target.value = '';
			});
			$('#btn-reset')?.addEventListener('click', resetAll);
		setActiveTab(ui.active || 'etfs');
				buildEtfChartControls();
	}

	async function ensureDefaults() {
		// If none of the keys exist yet, prefill from default-data.json
		const hasAny = localStorage.getItem(LS_KEYS.etfs)
			|| localStorage.getItem(LS_KEYS.purchases)
			|| localStorage.getItem(LS_KEYS.goals)
			|| localStorage.getItem(LS_KEYS.ui);
		if (hasAny) return;
		try {
			const res = await fetch('./default-data.json', { cache: 'no-store' });
			if (!res.ok) throw new Error(`Failed to fetch defaults: ${res.status}`);
			const data = await res.json();
			if (!Array.isArray(data.etfs) || !Array.isArray(data.purchases)) throw new Error('Invalid defaults');
			etfs = data.etfs || [];
			purchases = data.purchases || [];
			goals = Array.isArray(data.goals) ? data.goals : [];
			ui = data.ui || { active: 'etfs', expandedEtfs: [] };
			saveEtfs(); savePurchases(); saveGoals(); saveUi();
		} catch (e) {
			console.warn('Default data load failed:', e);
		} finally {
			reloadState();
		}
	}

	window.addEventListener('DOMContentLoaded', async () => {
		await ensureDefaults();
		initTabs();
	});
})();
