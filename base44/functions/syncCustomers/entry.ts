import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 });

    const orders = await base44.asServiceRole.entities.ProcessedOrder.list('-created_date', 5000);

    const normalizePhone = (p) => {
      if (!p) return null;
      let d = String(p).replace(/\D/g, '');
      if (d.length === 10) d = '1' + d;
      if (d.length === 11 && d.startsWith('1')) return '+' + d;
      if (d.length > 11) return '+' + d;
      return null;
    };

    const groups = new Map();
    for (const o of orders) {
      const email = o.customer_email ? String(o.customer_email).trim().toLowerCase() : '';
      const phone = normalizePhone(o.customer_phone);
      const key = email || (phone ? 'phone:' + phone : null);
      if (!key) continue;
      let g = groups.get(key);
      if (!g) {
        g = {
          name: o.customer_name || '',
          email: email || '',
          phone: phone || '',
          total_orders: 0,
          total_spent: 0,
          first: null,
          last: null,
          stores: new Set(),
          order_types: new Set(),
          last_store: '',
        };
        groups.set(key, g);
      }
      g.total_orders += 1;
      g.total_spent += Number(o.amount) || 0;
      const od = o.order_date ? new Date(o.order_date) : null;
      if (od && !isNaN(od.getTime())) {
        if (!g.first || od < g.first) g.first = od;
        if (!g.last || od > g.last) { g.last = od; g.last_store = o.store_name || g.last_store; }
      }
      if (o.store_name) g.stores.add(o.store_name);
      if (o.order_type) g.order_types.add(o.order_type);
    }

    const records = Array.from(groups.values()).map((g) => ({
      name: g.name,
      email: g.email,
      phone: g.phone,
      total_orders: g.total_orders,
      total_spent: Math.round(g.total_spent * 100) / 100,
      avg_order_value: g.total_orders ? Math.round((g.total_spent / g.total_orders) * 100) / 100 : 0,
      first_order_date: g.first ? g.first.toISOString() : null,
      last_order_date: g.last ? g.last.toISOString() : null,
      stores: Array.from(g.stores),
      order_types: Array.from(g.order_types),
      last_store: g.last_store,
    }));

    await base44.asServiceRole.entities.Customer.deleteMany({});
    await base44.asServiceRole.entities.Customer.bulkCreate(records);

    return Response.json({
      customers: records.length,
      orders_processed: orders.length,
      total_revenue: Math.round(records.reduce((s, r) => s + r.total_spent, 0) * 100) / 100,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}