// ==============================================================
// 1. CONFIGURACIÓN DE CONEXIÓN (API)
// ==============================================================

// 👇 TU URL DE APPS SCRIPT
const API_URL = "https://script.google.com/macros/s/AKfycbzDr6Hhetw3EMqIdrMszZHkyXTXS1KUg6iQ5ahmPkUz35QqTFuSymAkg6gqdUXg5wlncA/exec";

async function apiService(action, payload = {}) {
    try {
        const bodyData = JSON.stringify({ action: action, ...payload });
        
        const response = await fetch(API_URL, {
            method: "POST",
            body: bodyData
        });

        const result = await response.json();
        return result;

    } catch (error) {
        console.error("Error crítico de API:", error);
        return { success: false, message: "Error de conexión: " + error.message };
    }
}

// ==============================================================
// 2. VARIABLES GLOBALES
// ==============================================================
let INVENTARIO_SIMPLE = [];
let INVENTARIO_COMBOS = [];
let CARRITO = [];
let ventasChartInstance = null;
let ANALISIS_DATA_CACHE = {};

// ==============================================================
// 3. FUNCIONES DE UTILIDAD
// ==============================================================

function formatCurrency(amount) {
    return `$ ${parseFloat(amount).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

function showMessage(id, message, isSuccess, duration = 8000) {
    const msgDiv = document.getElementById(id);
    if (!msgDiv) return;
    msgDiv.textContent = message;
    msgDiv.className = isSuccess ? 'message success' : 'message error';
    msgDiv.style.display = 'block';
    setTimeout(() => { msgDiv.style.display = 'none'; }, isSuccess ? 4000 : 8000);
}

function showSuccessMessage(id, htmlContent) {
    const msgDiv = document.getElementById(id);
    if (!msgDiv) return;
    msgDiv.innerHTML = htmlContent;
    msgDiv.className = 'message success';
    msgDiv.style.display = 'block';
    setTimeout(() => { msgDiv.style.display = 'none'; }, 8000);
}

function toggleCart() {
    const panel = document.getElementById('cart-panel');
    if (panel) panel.classList.toggle('active');
}

// ==============================================================
// 4. NAVEGACIÓN (TABS)
// ==============================================================

function openTab(evt, tabName) {
    document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.nav-tabs .tab-button').forEach(el => el.classList.remove('active'));

    const targetTab = document.getElementById(tabName);
    if (targetTab) targetTab.style.display = 'block';

    if (evt && evt.currentTarget) evt.currentTarget.classList.add('active');

    // Cargas automáticas
    if (tabName === 'Ventas' || tabName === 'Inventario' || tabName === 'Gestion') {
        cargarInventario();
    }
    if (tabName === 'Gestion') {
        document.getElementById('SubRecetas').style.display = 'block';
        document.querySelectorAll('#Gestion .nav-tabs .tab-button')[0].classList.add('active');
    }
    if (tabName === 'ListadoPrecios') {
        cargarListadoPrecios();
    }

    if (tabName !== 'Ventas') {
        const panel = document.getElementById('cart-panel');
        if (panel) panel.classList.remove('active');
    }
}

function openSubTab(evt, tabName) {
    document.querySelectorAll('.tab-content-sub').forEach(el => el.style.display = 'none');
    document.querySelectorAll('#Gestion .nav-tabs .tab-button').forEach(el => el.classList.remove('active'));
    document.getElementById(tabName).style.display = "block";
    evt.currentTarget.classList.add('active');

    if (tabName === 'SubMetricas') obtenerEstadisticas();
}

// ==============================================================
// 5. LÓGICA DE INVENTARIO Y VENTAS
// ==============================================================

async function cargarInventario() {
    const res = await apiService('obtenerInventario');
    
    if (res.success) {
        INVENTARIO_SIMPLE = res.productos;
        INVENTARIO_COMBOS = res.combos;
        renderQuickSelect();
        if (document.getElementById('Ventas').style.display === 'block') {
             console.log('Inventario sincronizado');
        }
    } else {
        showMessage('venta-message', 'Error cargando inventario: ' + res.message, false);
    }
}

function renderQuickSelect() {
    const container = document.getElementById('quick-select-container');
    if (!container) return;
    container.innerHTML = '';

    const destacados = INVENTARIO_COMBOS.filter(c => c.urlImagen && c.urlImagen.toString().startsWith('http'));
    let cardsHtml = '';
    
    destacados.forEach(prod => {
        const precioDisplay = formatCurrency(prod.precio);
        cardsHtml += `
            <div class="product-card" data-id="${prod.id}">
                <img src="${prod.urlImagen}" class="card-image" alt="${prod.nombre}">
                <div class="card-info">
                    <div class="card-title">${prod.nombre}</div>
                    <div class="card-price">${precioDisplay}</div>
                </div>
                <div class="card-controls">
                    <input type="number" class="control-qty-card" id="qty-${prod.id}" value="1" min="1" step="1">
                    <button class="control-btn" onclick="agregarProductoDesdeCard('${prod.id}', document.getElementById('qty-${prod.id}').value)">Añadir</button>
                </div>
            </div>
        `;
    });
    container.innerHTML = cardsHtml;
}

function agregarProductoDesdeBusqueda() {
    const id = document.getElementById('search-id').value;
    const qty = document.getElementById('search-qty').value;
    agregarProducto(id, qty);
}

function agregarProductoDesdeCard(id, qty) {
    agregarProducto(id, qty);
}

function agregarProducto(id, qty) {
    const prodId = String(id).trim();
    const cantidad = parseFloat(qty);

    if (!prodId || cantidad <= 0 || isNaN(cantidad)) {
        showMessage('venta-message', 'Código o cantidad inválida.', false);
        return;
    }

    let item = INVENTARIO_COMBOS.find(c => String(c.id) === prodId);
    if (!item) {
        showMessage('venta-message', 'Producto no encontrado en Recetas.', false);
        return;
    }
    
    const precioUnitario = parseFloat(item.precio);
    const subtotal = precioUnitario * cantidad;

    const itemVenta = {
        id: item.id,
        nombre: item.nombre,
        cantidad: cantidad,
        precio: precioUnitario,
        subtotal: subtotal,
        descuentoPct: 0,
        componentes: calcularComponentesCombo(item, cantidad)
    };

    CARRITO.push(itemVenta);
    renderCarrito();
    
    const searchInput = document.getElementById('search-id');
    if(searchInput) searchInput.value = '';
    
    const panel = document.getElementById('cart-panel');
    if (panel && !panel.classList.contains('active')) toggleCart();
}

function calcularComponentesCombo(combo, cantidadVendida) {
    if (!combo.componentes || !Array.isArray(combo.componentes)) return [];
    return combo.componentes.map(comp => ({
        id: comp.id,
        cantidadConsumida: parseFloat(comp.cantidadBase) * (parseFloat(combo.factor) || 1) * cantidadVendida
    }));
}

function eliminarItem(index) {
    CARRITO.splice(index, 1);
    renderCarrito();
}

function actualizarDescuento(index, inputElement) {
    let descPct = parseFloat(inputElement.value);
    if (isNaN(descPct) || descPct < 0) descPct = 0;
    if (descPct > 100) descPct = 100;
    CARRITO[index].descuentoPct = descPct;
    renderCarrito();
}

function renderCarrito() {
    const body = document.getElementById('cart-body-flotante');
    const cartCount = document.getElementById('cart-count');
    const detailsFooter = document.getElementById('cart-details-footer');
    
    body.innerHTML = '';
    let totalFinalVenta = 0;
    let totalDescuentoMonto = 0;
    let subtotalSinDesc = 0;

    if (CARRITO.length === 0) {
        body.innerHTML = '<p style="padding: 10px; text-align: center; color: #888;">Vacío</p>';
    }

    CARRITO.forEach((item, index) => {
        const precioTotalLinea = item.subtotal;
        subtotalSinDesc += precioTotalLinea;
        const descMonto = precioTotalLinea * (item.descuentoPct / 100);
        const subtotalFinal = precioTotalLinea - descMonto;
        
        totalFinalVenta += subtotalFinal;
        totalDescuentoMonto += descMonto;
        
        const precioUnitarioFinal = subtotalFinal / item.cantidad;

        const row = document.createElement('div');
        row.className = 'cart-item-row';
        row.innerHTML = `
            <div>${item.nombre}<br><span style="font-size: 0.75em; color: #666;">$${precioUnitarioFinal.toFixed(2)} x ${item.cantidad}</span></div>
            <div style="text-align: right;">
                <strong style="color: ${descMonto > 0.01 ? '#dc3545' : '#333'};">${formatCurrency(subtotalFinal)}</strong>
                <div style="font-size: 0.75em;">
                    Desc: <input type="number" style="width: 35px;" value="${item.descuentoPct}" oninput="actualizarDescuento(${index}, this)">%
                    <button onclick="eliminarItem(${index})" style="background: #dc3545; color: white; border: none;">X</button>
                </div>
            </div>`;
        body.appendChild(row);
    });

    cartCount.textContent = CARRITO.length;
    document.getElementById('modal-total-final').textContent = formatCurrency(totalFinalVenta);
    
    detailsFooter.innerHTML = `
        <p>Subtotal: <span style="float: right;">${formatCurrency(subtotalSinDesc)}</span></p>
        ${totalDescuentoMonto > 0.01 ? `<p style="color: #dc3545;">Ahorro: <span style="float: right;">-${formatCurrency(totalDescuentoMonto)}</span></p>` : ''}
        <div class="total">Total: <span id="cart-total">${formatCurrency(totalFinalVenta)}</span></div>
    `;
}

function mostrarModalConfirmacion() {
    if (CARRITO.length === 0) return showMessage('venta-message', 'Carrito vacío', false);
    
    let html = '<table class="cart-table" style="width:100%"><thead><tr><th>Prod</th><th>Cant</th><th>$ Final</th></tr></thead><tbody>';
    let total = 0;
    CARRITO.forEach(item => {
        const final = item.subtotal - (item.subtotal * (item.descuentoPct/100));
        total += final;
        html += `<tr><td>${item.nombre}</td><td>${item.cantidad}</td><td>${formatCurrency(final)}</td></tr>`;
    });
    html += '</tbody></table>';
    
    document.getElementById('modal-detalle').innerHTML = html;
    document.getElementById('modal-total').textContent = formatCurrency(total);
    document.getElementById('confirmModal').style.display = 'block';
}

function cerrarModal() {
    document.getElementById('confirmModal').style.display = 'none';
}

async function registrarVenta() {
    cerrarModal();
    if (CARRITO.length === 0) return;

    let totalDesc = 0;
    const carritoFinal = CARRITO.map(item => {
        const desc = item.subtotal * (item.descuentoPct / 100);
        totalDesc += desc;
        const final = item.subtotal - desc;
        return {
            ...item,
            subtotal: final.toFixed(2),
            precio: (final / item.cantidad).toFixed(2),
            observaciones: `Desc: ${item.descuentoPct}%`
        };
    });

    const ventaData = {
        clienteId: document.getElementById('clienteIdFlotante').value || 'CONSUMIDOR FINAL',
        metodoPago: document.getElementById('metodoPagoFlotante').value,
        carrito: carritoFinal,
        observaciones: `Total Desc. Aplicado: ${totalDesc.toFixed(2)}`
    };

    showMessage('venta-message', 'Procesando venta...', true);

    const res = await apiService('registrarVenta', { datos: ventaData });

    if (res.success) {
        const match = res.message.match(/Venta\s(\d+)/);
        const idVenta = match ? match[1] : null;
        const btnRemito = idVenta ? `<button onclick="irARemito('${idVenta}')" class="btn-primary" style="margin-left: 10px;">Ver Remito</button>` : '';
        
        showSuccessMessage('venta-message', `${res.message} ${btnRemito}`);
        
        CARRITO = [];
        renderCarrito();
        cargarInventario();
        toggleCart();
    } else {
        showMessage('venta-message', res.message, false);
    }
}

// ==============================================================
// 6. GESTIÓN DE CLIENTES, MERCADERÍA Y RECETAS
// ==============================================================

async function enviarCliente() {
    const data = {
        nombre: document.getElementById('nombre').value,
        domicilio: document.getElementById('domicilio').value,
        referencia: document.getElementById('referencia').value,
        tel1: document.getElementById('tel1').value,
        email: document.getElementById('email').value
    };
    if(!data.nombre) return showMessage('cliente-message', 'Nombre obligatorio', false);

    const res = await apiService('registrarCliente', { datos: data });
    showMessage('cliente-message', res.message, res.success);
    if (res.success) document.getElementById('form-cliente').reset();
}

async function enviarMercaderia() {
    const data = {
        idProducto: document.getElementById('idProducto').value,
        cantidad: document.getElementById('cantidad').value,
        costo: document.getElementById('costo').value,
        idProveedor: document.getElementById('idProveedor').value
    };
    if(!data.idProducto) return showMessage('mercaderia-message', 'Complete campos', false);

    const res = await apiService('ingresarMercaderia', { datos: data });
    showMessage('mercaderia-message', res.message, res.success);
    if (res.success) document.getElementById('form-mercaderia').reset();
}

function agregarComponente() {
    const div = document.createElement('div');
    div.className = 'component-row';
    div.innerHTML = `<input type="text" class="component-id" placeholder="ID"><input type="number" class="component-qty" placeholder="Cant"><button type="button" onclick="this.parentNode.remove()">X</button>`;
    document.getElementById('componentes-container').appendChild(div);
}

async function enviarReceta() {
    const rows = document.querySelectorAll('#componentes-container .component-row');
    const componentes = [];
    rows.forEach(row => {
        const id = row.querySelector('.component-id').value;
        const qty = row.querySelector('.component-qty').value;
        if(id && qty) componentes.push({ id: id, cantidad: qty });
    });

    const data = {
        id: document.getElementById('receta-id').value,
        nombre: document.getElementById('receta-nombre').value,
        precio: document.getElementById('receta-precio').value,
        factor: document.getElementById('receta-factor').value,
        componentes: componentes
    };

    if(!data.id) return showMessage('receta-message', 'Falta ID', false);

    const res = await apiService('registrarRecetaCombo', { datos: data });
    showMessage('receta-message', res.message, res.success);
}

async function enviarEgreso() {
    const data = {
        tipo: document.getElementById('egreso-tipo').value,
        categoriaId: document.getElementById('egreso-categoria').value,
        monto: document.getElementById('egreso-monto').value,
        descripcion: document.getElementById('egreso-descripcion').value
    };
    if(!data.monto) return showMessage('egreso-message', 'Monto obligatorio', false);

    const res = await apiService('registrarEgreso', { datos: data });
    showMessage('egreso-message', res.message, res.success);
    if(res.success) document.getElementById('form-egreso').reset();
}

// ==============================================================
// 7. REMITO (Corregido)
// ==============================================================

function irARemito(id) {
    document.getElementById('remitoNumPedido').value = id;
    // Simular click en tab Remito
    const tabs = document.querySelectorAll(".tab-button");
    // Buscamos el botón que dice "Remito"
    let remitoBtn = null;
    tabs.forEach(btn => { if(btn.innerText.includes("Remito")) remitoBtn = btn; });
    
    if(remitoBtn) openTab({currentTarget: remitoBtn}, 'Remito');
    cargarRemito();
}

async function cargarRemito() {
    const id = document.getElementById('remitoNumPedido').value;
    if(!id) return showMessage('remito-message', 'Ingrese ID', false);

    document.getElementById('remitoResultado').innerHTML = 'Cargando...';
    // Usamos action 'obtenerDatosRemito' que agregamos al Code.gs
    const res = await apiService('obtenerDatosRemito', { id: id }); 

    if(!res.success) {
        document.getElementById('remitoResultado').innerHTML = res.message;
        return;
    }
    
    renderRemito(res.data);
    document.getElementById('botonesRemito').hidden = false;
    showMessage('remito-message', 'Listo', true);
}

function renderRemito(data) {
    // 1. Filas de productos
    let itemsHtml = '';
    data.productos.forEach(p => {
        itemsHtml += `
        <tr>
            <td>${p.codigo}</td>
            <td>${p.cantidad}</td>
            <td>${p.descripcion}</td>
            <td style="text-align:right">${formatCurrency(p.precioLista)}</td>
            <td style="text-align:right"><strong>${formatCurrency(p.precioLista * p.cantidad)}</strong></td>
        </tr>`;
    });

    // 2. Rellenar filas vacías (Mínimo 7)
    const MIN_FILAS = 7;
    const filasVacias = Math.max(0, MIN_FILAS - data.productos.length);
    for (let i = 0; i < filasVacias; i++) {
        itemsHtml += '<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td></tr>';
    }

    // 3. Totales y Descuentos
    // (OJO: data.total es el TOTAL FINAL pagado. Si hubo descuento, el subtotal era mayor)
    // Extraemos el descuento de las observaciones si existe
    const descuentoMatch = data.observaciones ? data.observaciones.match(/Total Desc\.\sAplicado:\s([\d.,]+)/) : null;
    const montoDescuento = descuentoMatch ? parseFloat(descuentoMatch[1].replace(',', '.')) : 0; 
    const subtotalReal = Number(data.total) + montoDescuento;

    const html = `
        <div id="remitoContainer" class="remito">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <img src="logo.png" style="height: 100px;" alt="Logo" />
                <div style="text-align:center">
                    <h2>COMBOS EXPRESS MERLO</h2>
                    <p>Whatsapp: 11-7208-8753</p>
                </div>
                <div style="text-align:right">
                    <p style="border:1px solid #000; padding:5px">Remito: <strong>0-${data.id}</strong></p>
                </div>
            </div>
            <hr>
            <table style="width:100%; margin-bottom:10px;">
                <tr><td><strong>Cliente:</strong> ${data.cliente.nombre}</td><td><strong>ID:</strong> ${data.cliente.id}</td></tr>
                <tr><td><strong>Domicilio:</strong> ${data.cliente.domicilio}</td><td><strong>Fecha:</strong> ${data.fecha}</td></tr>
            </table>
            
            <table class="remito-tabla" style="width:100%; border-collapse:collapse; border:1px solid #000;">
                <thead style="background:#eee;">
                    <tr>
                        <th style="border:1px solid #000">Cod</th>
                        <th style="border:1px solid #000">Cant</th>
                        <th style="border:1px solid #000">Desc</th>
                        <th style="border:1px solid #000; text-align:right">Unit</th>
                        <th style="border:1px solid #000; text-align:right">Total</th>
                    </tr>
                </thead>
                <tbody>${itemsHtml}</tbody>
            </table>
            
            <table style="width:100%; margin-top:10px;">
                 <tr>
                    <td><strong>Pago:</strong> ${data.metodoPago}</td>
                    <td style="text-align:right">Subtotal:</td>
                    <td style="text-align:right">${formatCurrency(subtotalReal)}</td>
                 </tr>
                 ${montoDescuento > 0 ? `<tr><td></td><td style="text-align:right; color:red">Bonificación:</td><td style="text-align:right; color:red">-${formatCurrency(montoDescuento)}</td></tr>` : ''}
                 <tr>
                    <td></td>
                    <td style="text-align:right; font-size:1.2em; background:#eee;"><strong>TOTAL:</strong></td>
                    <td style="text-align:right; font-size:1.2em; background:#eee;"><strong>${formatCurrency(data.total)}</strong></td>
                 </tr>
            </table>
            
            <p style="text-align:center; font-size:0.8em; margin-top:20px;">Documento no válido como factura</p>
        </div>
    `;
    document.getElementById('remitoResultado').innerHTML = html;
}

function descargarPNGRemito() {
    const element = document.getElementById('remitoContainer');
    if(!element) return showMessage('remito-message', 'No hay remito', false);
    
    // html2canvas necesita ejecutarse después de que la imagen cargue
    // pero como es local, suele ser rápido.
    html2canvas(element, { scale: 2, backgroundColor: "#ffffff" }).then(canvas => {
        const link = document.createElement('a');
        link.download = `Remito_${document.getElementById('remitoNumPedido').value}.png`;
        link.href = canvas.toDataURL();
        link.click();
    });
}

// ==============================================================
// 8. REPORTES Y PRECIOS (Restaurado con Categorías)
// ==============================================================

async function obtenerEstadisticas() {
    showMessage('metricas-message', 'Cargando...', true);
    const res = await apiService('obtenerReportes');
    if(res.success) renderEstadisticas(res);
    else showMessage('metricas-message', res.message, false);
}

function renderEstadisticas(data) {
    document.getElementById('resumen-metrics').innerHTML = `
        <div class="metric-box sales-box"><h4>Ventas</h4><p>${formatCurrency(data.resumenGeneral.totalVentas)}</p></div>
        <div class="metric-box profit-box"><h4>Ganancia Bruta</h4><p>${formatCurrency(data.resumenGeneral.totalGananciaBruta)}</p></div>
        <div class="metric-box expense-box"><h4>Egresos</h4><p>${formatCurrency(data.resumenGeneral.totalEgresos)}</p></div>
    `;
    
    // Gráfico
    if (data.resumenDiario) renderVentasChart(data.resumenDiario);

    // Tablas (simplificado para brevedad, pero funcional)
    // ... (puedes añadir las tablas de resumen diario y egresos aquí si las necesitas visibles)
}

function renderVentasChart(resumen) {
    const ctx = document.getElementById('ventasChart').getContext('2d');
    const labels = Object.keys(resumen).sort();
    const values = labels.map(k => resumen[k].ventas);
    
    if(ventasChartInstance) ventasChartInstance.destroy();
    
    ventasChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{ label: 'Ventas', data: values, backgroundColor: '#0099ff' }]
        },
        options: { maintainAspectRatio: false }
    });
}

async function cargarListadoPrecios() {
    const container = document.getElementById('listado-precios-output');
    container.innerHTML = '<p>⏳ Cargando lista de precios...</p>';
    
    const res = await apiService('obtenerPrecios');
    
    if(res.success && res.data) {
        mostrarListadoPrecios(res.data); 
    } else {
        container.innerHTML = '<p class="message error">Error: ' + (res.message || 'Sin datos') + '</p>';
    }
}

function mostrarListadoPrecios(datos) {
    const container = document.getElementById('listado-precios-output');
    if (!datos || datos.length === 0) {
        container.innerHTML = '<p class="message">No se encontraron productos.</p>';
        return;
    }

    // 1. Agrupar por categoría
    const grupos = datos.reduce((acc, p) => {
        const cat = (p.categoria && p.categoria.trim() !== "") ? p.categoria : 'Sin Categoría';
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(p);
        return acc;
    }, {});

    // 2. Orden personalizado
    const orden = [
        'Combos Super Pancho', 'Combos Hamburguesa', 'Hamburguesas', 'Salchichas', 
        'Panificados', 'Aderezos', 'Envios', 'Sin Categoría'
    ];
    
    const catOrdenadas = Object.keys(grupos).sort((a, b) => {
        let ia = orden.indexOf(a), ib = orden.indexOf(b);
        if(ia === -1) ia = 999; if(ib === -1) ib = 999;
        return ia - ib;
    });

    // 3. Renderizar
    let html = '';
    catOrdenadas.forEach(cat => {
        html += `<h4 style="margin-top:25px; color:#0099ff; border-bottom:2px solid #eee;">${cat}</h4>`;
        html += `<table class="data-table-metrics" style="width:100%"><thead><tr style="background:#f9f9f9"><th style="text-align:left">Código</th><th>Producto</th><th style="text-align:right">Precio</th></tr></thead><tbody>`;
        
        // Ordenar alfabéticamente dentro de la categoría
        grupos[cat].sort((a,b) => a.nombre.localeCompare(b.nombre));

        grupos[cat].forEach(p => {
            html += `<tr>
                <td style="font-weight:bold; color:#555">${p.id}</td>
                <td>${p.nombre}</td>
                <td style="text-align:right; font-weight:bold; color:#0099ff">${formatCurrency(p.precio)}</td>
            </tr>`;
        });
        html += `</tbody></table>`;
    });
    container.innerHTML = html;
}

function filtrarTablaPrecios() {
    const input = document.getElementById('filtro-precios');
    const filter = input.value.toUpperCase();
    const rows = document.querySelectorAll('#listado-precios-output table tr');
    
    rows.forEach(row => {
        // Ignorar encabezados
        if(row.parentNode.tagName === 'THEAD') return;
        
        const txt = row.innerText || row.textContent;
        row.style.display = txt.toUpperCase().indexOf(filter) > -1 ? "" : "none";
    });
}

async function cargarDatosParaAnalisis() {
    const id = document.getElementById('costo-search-id').value;
    showMessage('costos-message', 'Cargando...', true);
    
    const res = await apiService('obtenerAnalisisPrecio', { id: id });
    
    if(res.success) {
        ANALISIS_DATA_CACHE = res.data;
        renderAnalisisCosto(res.data);
        showMessage('costos-message', 'Datos cargados.', true);
    } else {
        showMessage('costos-message', res.message, false);
    }
}

function renderAnalisisCosto(data) {
     const outputDiv = document.getElementById('costo-analisis-output');
     const margen = calcularMargen(data.precioVenta, data.costo);
     
     outputDiv.innerHTML = `
        <h4>${data.nombre} (${data.id})</h4>
        <table class="data-table-metrics" style="width:100%">
            <thead><tr><th>Concepto</th><th>Valor</th><th>Margen</th></tr></thead>
            <tbody>
                <tr><td>Costo Actual</td><td>${formatCurrency(data.costo)}</td><td>-</td></tr>
                <tr><td>Precio Venta</td><td>${formatCurrency(data.precioVenta)}</td><td>${margen.margen}%</td></tr>
            </tbody>
        </table>
        <hr>
        <div style="display:flex; gap:10px; margin-top:10px;">
            <div style="flex:1"><label>Nuevo Costo</label><input type="number" id="nuevo-costo" value="${data.costo}" oninput="simularPrecio()" style="width:100%"></div>
            <div style="flex:1"><label>Nuevo Precio</label><input type="number" id="nuevo-precio" value="${data.precioVenta}" oninput="simularPrecio()" style="width:100%"></div>
        </div>
        <div id="simulacion-output" style="background:#f0f7ff; padding:10px; margin:10px 0; border-radius:5px;">Simulación...</div>
        <input type="text" id="log-observaciones" placeholder="Observaciones (ej: Aumento proveedor)" style="width:100%; margin-bottom:10px;">
        <button class="btn-primary btn-success" onclick="aplicarCambios()" style="width:100%">Guardar Cambios</button>
     `;
     simularPrecio();
}

function simularPrecio() {
    const nc = parseFloat(document.getElementById('nuevo-costo').value);
    const np = parseFloat(document.getElementById('nuevo-precio').value);
    if(isNaN(nc) || isNaN(np)) return;
    
    const sim = calcularMargen(np, nc);
    document.getElementById('simulacion-output').innerHTML = `
        <strong>Ganancia:</strong> ${formatCurrency(sim.ganancia)} <br>
        <strong>Margen:</strong> ${sim.margen}%
    `;
}

function calcularMargen(p, c) {
    if(!p) return {ganancia:0, margen:0};
    return { ganancia: p-c, margen: ((p-c)/p*100).toFixed(1) };
}

async function aplicarCambios() {
    const nc = document.getElementById('nuevo-costo').value;
    const np = document.getElementById('nuevo-precio').value;
    const obs = document.getElementById('log-observaciones').value;
    
    const payload = {
        id: ANALISIS_DATA_CACHE.id,
        costoAnterior: ANALISIS_DATA_CACHE.costo,
        precioVentaAnterior: ANALISIS_DATA_CACHE.precioVenta,
        nuevoCosto: nc,
        nuevoPrecioVenta: np,
        observaciones: obs
    };
    
    showMessage('costos-message', 'Guardando...', true);
    const res = await apiService('actualizarPrecio', { datos: payload });
    showMessage('costos-message', res.message, res.success);
    
    if(res.success) cargarDatosParaAnalisis(); // Recargar para ver cambios
}

async function buscarClienteDetalle() {
    const id = document.getElementById('search-cliente-id').value.trim();
    if(!id) return showMessage('cliente-detalle-message', 'Ingrese ID', false);

    document.getElementById('cliente-detalle-output').innerHTML = 'Cargando...';
    
    const res = await apiService('obtenerDetalleCliente', { id: id });
    
    if(res.success) {
        renderClienteDetalleCompleto(res.data);
    } else {
        document.getElementById('cliente-detalle-output').innerHTML = res.message;
    }
}

function renderClienteDetalleCompleto(data) {
    const div = document.getElementById('cliente-detalle-output');
    let html = `
        <div style="background:#f9f9f9; padding:15px; border-radius:8px; border:1px solid #eee;">
            <h3 style="margin-top:0">${data.nombre}</h3>
            <p>Compras: <strong>${data.comprasCount}</strong> | Total: <strong>${formatCurrency(data.totalFacturado)}</strong></p>
        </div>
        <table class="data-table-metrics" style="width:100%; margin-top:10px;">
            <thead><tr><th>Fecha</th><th>ID</th><th style="text-align:right">Monto</th></tr></thead>
            <tbody>
    `;
    data.historialVentas.forEach(v => {
        html += `<tr><td>${v.fecha}</td><td>0-${v.idVenta}</td><td style="text-align:right">${formatCurrency(v.importe)}</td></tr>`;
    });
    html += '</tbody></table>';
    div.innerHTML = html;
}

// ==============================================================
// 9. INICIO
// ==============================================================
window.onload = function() {
    openTab(null, 'Ventas'); 
    const firstBtn = document.querySelector('.nav-tabs .tab-button');
    if(firstBtn) firstBtn.classList.add('active');
};