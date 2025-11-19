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

function showMessage(id, message, isSuccess, duration = 5000) {
    const msgDiv = document.getElementById(id);
    if (!msgDiv) return;
    msgDiv.textContent = message;
    msgDiv.className = isSuccess ? 'message success' : 'message error';
    msgDiv.style.display = 'block';
    setTimeout(() => { msgDiv.style.display = 'none'; }, duration);
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
        console.log('Inventario sincronizado');
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
        item = INVENTARIO_SIMPLE.find(p => String(p.id) === prodId);
        if (!item) {
            showMessage('venta-message', 'Producto no encontrado.', false);
            return;
        }
        // Si es producto simple, usar costo como precio si no tiene precio definido (parche)
        if (!item.precio && item.costoPromedio) item.precio = item.costoPromedio;
    }
    
    const precioUnitario = parseFloat(item.precio);
    if (isNaN(precioUnitario) || precioUnitario <= 0) {
         showMessage('venta-message', `El producto ${prodId} no tiene precio de venta.`, false);
         return;
    }

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
                    <button onclick="eliminarItem(${index})" style="background: #dc3545; color: white; border: none; cursor: pointer;">X</button>
                </div>
            </div>`;
        body.appendChild(row);
    });

    cartCount.textContent = CARRITO.length;
    const totalBtn = document.getElementById('modal-total-final');
    if(totalBtn) totalBtn.textContent = formatCurrency(totalFinalVenta);
    
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
        const desc = item.subtotal * (item.descuentoPct / 100);
        const final = item.subtotal - desc;
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
// 6. GESTIÓN Y REMITOS
// ==============================================================

// ... (Clientes, Mercadería, Recetas, Egresos siguen igual, solo asegúrate de que estén aquí) ...
// (Por brevedad, asumo que tienes esas funciones de gestión. Si no, avísame y las pego)
async function enviarCliente() { /* ... */ }
async function enviarMercaderia() { /* ... */ }
function agregarComponente() { /* ... */ }
async function enviarReceta() { /* ... */ }
async function enviarEgreso() { /* ... */ }


// --- REMITO CON LOGO LOCAL Y DISEÑO FIJO ---

function irARemito(id) {
    document.getElementById('remitoNumPedido').value = id;
    const tabs = document.querySelectorAll(".tab-button");
    let remitoBtn = null;
    tabs.forEach(btn => { if(btn.innerText.includes("Remito")) remitoBtn = btn; });
    if(remitoBtn) openTab({currentTarget: remitoBtn}, 'Remito');
    cargarRemito();
}

async function cargarRemito() {
    const id = document.getElementById('remitoNumPedido').value;
    if(!id) return showMessage('remito-message', 'Ingrese ID', false);

    document.getElementById('remitoResultado').innerHTML = 'Cargando...';
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

    // Relleno de filas (Mínimo 7)
    const MIN_FILAS = 7;
    const filasVacias = Math.max(0, MIN_FILAS - data.productos.length);
    for (let i = 0; i < filasVacias; i++) {
        itemsHtml += '<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td></tr>';
    }

    const descuentoMatch = data.observaciones ? data.observaciones.match(/Total Desc\.\sAplicado:\s([\d.,]+)/) : null;
    const montoDescuento = descuentoMatch ? parseFloat(descuentoMatch[1].replace(',', '.')) : 0; 
    const subtotalReal = Number(data.total) + montoDescuento;

    // HTML con wrapper para scroll y div fijo para impresión
    const html = `
        <div class="remito-wrapper-responsive">
            <div id="remitoContainer" class="remito-visual">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                    <img src="logo.png" style="height: 100px; object-fit:contain;" alt="Logo" />
                    <div style="text-align:center; flex:1;">
                        <h2 style="margin:0;">COMBOS EXPRESS MERLO</h2>
                        <p style="margin:5px 0;">Whatsapp: 11-7208-8753</p>
                    </div>
                    <div style="text-align:right">
                        <div style="border:2px solid #000; padding:5px 10px;">
                            Remito N°<br><span style="font-size:1.2em; font-weight:bold;">0-${data.id}</span>
                        </div>
                    </div>
                </div>
                <hr style="border:1px solid #000; margin-bottom:15px;">
                <table style="width:100%; margin-bottom:15px; border:none;">
                    <tr style="border:none;"><td style="border:none;"><strong>Cliente:</strong> ${data.cliente.nombre}</td><td style="border:none;"><strong>ID:</strong> ${data.cliente.id}</td></tr>
                    <tr style="border:none;"><td style="border:none;"><strong>Domicilio:</strong> ${data.cliente.domicilio}</td><td style="border:none;"><strong>Fecha:</strong> ${data.fecha}</td></tr>
                </table>
                
                <table class="remito-tabla" style="width:100%; border-collapse:collapse; border:1px solid #000;">
                    <thead style="background:#eee;">
                        <tr>
                            <th style="border:1px solid #000">CÓDIGO</th>
                            <th style="border:1px solid #000">CANT</th>
                            <th style="border:1px solid #000">DESCRIPCIÓN</th>
                            <th style="border:1px solid #000; text-align:right">UNITARIO</th>
                            <th style="border:1px solid #000; text-align:right">TOTAL</th>
                        </tr>
                    </thead>
                    <tbody>${itemsHtml}</tbody>
                </table>
                
                <div style="display: flex; justify-content: flex-end; margin-top: 10px;">
                    <table style="width:50%; border-collapse:collapse;">
                         <tr><td style="border:none; text-align:right; padding-right:10px;">Subtotal:</td><td style="border:1px solid #000; text-align:right; width:120px;">${formatCurrency(subtotalReal)}</td></tr>
                         ${montoDescuento > 0 ? `<tr><td style="border:none; text-align:right; padding-right:10px; color:red;">Bonificación:</td><td style="border:1px solid #000; text-align:right; color:red;">-${formatCurrency(montoDescuento)}</td></tr>` : ''}
                         <tr><td style="border:none; text-align:right; padding-right:10px; font-weight:bold; font-size:1.2em;">TOTAL:</td><td style="border:1px solid #000; text-align:right; font-weight:bold; font-size:1.2em; background:#eee;">${formatCurrency(data.total)}</td></tr>
                    </table>
                </div>
                <p style="text-align:center; font-size:0.8em; margin-top:20px; border-top:1px dashed #000; padding-top:5px;">Documento no válido como factura - Método de Pago: ${data.metodoPago}</p>
            </div>
        </div>
    `;
    document.getElementById('remitoResultado').innerHTML = html;
}

function limpiarRemito() {
    document.getElementById('remitoNumPedido').value = '';
    document.getElementById('remitoResultado').innerHTML = '<p>Utilice el botón "Buscar Venta".</p>';
    document.getElementById('botonesRemito').hidden = true;
    showMessage('remito-message', 'Limpiado', true);
}

function descargarPNGRemito() {
    const element = document.getElementById('remitoContainer');
    if(!element) return showMessage('remito-message', 'No hay remito', false);
    
    showMessage('remito-message', 'Generando imagen HD...', true);

    html2canvas(element, { scale: 2.5, useCORS: true, backgroundColor: "#ffffff" }).then(canvas => {
        const link = document.createElement('a');
        link.download = `Remito_${document.getElementById('remitoNumPedido').value}.png`;
        link.href = canvas.toDataURL();
        link.click();
        showMessage('remito-message', 'Descarga lista', true);
    });
}

// ==============================================================
// 8. LISTA DE PRECIOS (Con Categorías y Orden)
// ==============================================================

async function cargarListadoPrecios() {
    const container = document.getElementById('listado-precios-output');
    container.innerHTML = '<p>⏳ Cargando...</p>';
    
    const res = await apiService('obtenerPrecios');
    
    if(res.success && res.data) {
        mostrarListadoPrecios(res.data); 
    } else {
        container.innerHTML = '<p class="message error">Error: ' + (res.message || 'Sin datos') + '</p>';
    }
}

function mostrarListadoPrecios(datos) {
    const container = document.getElementById('listado-precios-output');
    if (!container) return;

    if (!datos || datos.length === 0) {
        container.innerHTML = '<p class="message">No se encontraron productos.</p>';
        return;
    }

    const grupos = datos.reduce((acc, p) => {
        const cat = (p.categoria && p.categoria.trim() !== "") ? p.categoria : 'Sin Categoría';
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(p);
        return acc;
    }, {});

    const orden = ['Combos Super Pancho', 'Combos Hamburguesa', 'Hamburguesas', 'Salchichas', 'Panificados', 'Aderezos', 'Envios', 'Sin Categoría'];
    const catOrdenadas = Object.keys(grupos).sort((a, b) => {
        let ia = orden.indexOf(a), ib = orden.indexOf(b);
        if(ia === -1) ia = 999; if(ib === -1) ib = 999;
        return ia - ib;
    });

    let html = '';
    catOrdenadas.forEach(cat => {
        html += `<h4 style="margin-top:25px; color:#0099ff; border-bottom:2px solid #eee;">${cat}</h4>`;
        html += `<table class="data-table-metrics" style="width:100%"><thead><tr style="background:#f9f9f9"><th style="text-align:left">Código</th><th>Producto</th><th style="text-align:right">Precio</th></tr></thead><tbody>`;
        
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
        if(row.parentNode.tagName === 'THEAD') return;
        const txt = row.innerText || row.textContent;
        row.style.display = txt.toUpperCase().indexOf(filter) > -1 ? "" : "none";
    });
}

// ... (Falta lógica de Costos y Clientes que ya tenías, pégala aquí si la necesitas) ...

// ==============================================================
// 9. INICIO
// ==============================================================
window.onload = function() {
    openTab(null, 'Ventas'); 
    const firstBtn = document.querySelector('.nav-tabs .tab-button');
    if(firstBtn) firstBtn.classList.add('active');
};  
