// CafeBot staff dashboard — reads/updates orders via the backend API.
// No auth: for local/dev use only.

const API_BASE = "http://localhost:3000";
const STATUSES = ["confirmed", "preparing", "ready", "completed", "cancelled"];

const ordersContainer = document.getElementById("ordersContainer");
const refreshButton = document.getElementById("refreshButton");

function formatMoney(amount) {
  return `$${Number(amount).toFixed(2)}`;
}

function formatItems(items) {
  return items
    .map((item) => {
      const customizations = item.options && item.options.length > 0 ? `, ${item.options.join(", ")}` : "";
      return `${item.quantity}x ${item.name} (${item.size}${customizations})`;
    })
    .join("; ");
}

function formatFulfillment(order) {
  if (order.orderType === "pickup") {
    const timeNote = order.pickupTime ? ` at ${order.pickupTime}` : "";
    return `Pickup for ${order.customer.name || "(no name)"}${timeNote}`;
  }
  if (order.orderType === "delivery") {
    const a = order.deliveryAddress || {};
    const addressNote = a.apartmentUnit ? `${a.address}, ${a.apartmentUnit}` : a.address;
    const instructionsNote = a.instructions ? ` — Instructions: ${a.instructions}` : "";
    return `Delivery for ${order.customer.name || "(no name)"}, ${order.customer.phone || "(no phone)"} — ${addressNote}${instructionsNote}`;
  }
  return "Fulfillment not set";
}

function buildStatusSelect(orderId, currentStatus) {
  const select = document.createElement("select");
  select.className = "status-select";
  select.dataset.orderId = orderId;

  for (const status of STATUSES) {
    const option = document.createElement("option");
    option.value = status;
    option.textContent = status;
    if (status === currentStatus) option.selected = true;
    select.appendChild(option);
  }

  select.addEventListener("change", () => updateOrderStatus(orderId, select.value));
  return select;
}

function renderOrders(orders) {
  ordersContainer.innerHTML = "";

  if (orders.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No orders yet.";
    ordersContainer.appendChild(empty);
    return;
  }

  // Newest first.
  const sorted = [...orders].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  for (const record of sorted) {
    const order = record.order;
    const card = document.createElement("div");
    card.className = "order-card";

    const header = document.createElement("div");
    header.className = "order-card-header";
    header.innerHTML = `
      <span class="order-id">#${record.orderId.slice(0, 8)}</span>
      <span class="order-time">${new Date(record.createdAt).toLocaleString()}</span>
    `;
    card.appendChild(header);

    const itemsSection = document.createElement("div");
    itemsSection.className = "order-section";
    itemsSection.innerHTML = `<div class="order-section-label">Items</div>${formatItems(order.items)}`;
    card.appendChild(itemsSection);

    const fulfillmentSection = document.createElement("div");
    fulfillmentSection.className = "order-section";
    fulfillmentSection.innerHTML = `<div class="order-section-label">Fulfillment</div>${formatFulfillment(order)}`;
    card.appendChild(fulfillmentSection);

    const totalSection = document.createElement("div");
    totalSection.className = "order-total";
    totalSection.textContent = `Total: ${formatMoney(order.total)}`;
    card.appendChild(totalSection);

    const footer = document.createElement("div");
    footer.className = "order-footer";

    const badge = document.createElement("span");
    badge.className = "status-badge";
    badge.dataset.status = record.status;
    badge.textContent = record.status;
    footer.appendChild(badge);

    footer.appendChild(buildStatusSelect(record.orderId, record.status));
    card.appendChild(footer);

    ordersContainer.appendChild(card);
  }
}

async function fetchOrders() {
  ordersContainer.innerHTML = '<p class="empty-state">Loading orders...</p>';
  try {
    const res = await fetch(`${API_BASE}/api/staff/orders`);
    const data = await res.json();
    renderOrders(data.orders || []);
  } catch (err) {
    ordersContainer.innerHTML = '<p class="empty-state">Could not load orders. Is the backend running?</p>';
  }
}

async function updateOrderStatus(orderId, status) {
  try {
    await fetch(`${API_BASE}/api/staff/orders/${orderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    fetchOrders();
  } catch (err) {
    alert("Could not update order status.");
  }
}

refreshButton.addEventListener("click", fetchOrders);
fetchOrders();
