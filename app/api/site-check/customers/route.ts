import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/auth";
import { querySource } from "@/lib/source-api";

export const dynamic = "force-dynamic";

// Site Check's "Search customer" box (public/site-check, built by scripts/build-site-check.py):
// prod_main invoices matching a customer name, phone number or invoice number, one row per
// invoice, with what the New Site Visit form fills in: name, phone, salesperson, address.
// Signed-in users only; at most 20 rows, never the table.

type Row = {
  bubble_id: string;
  invoice_number: string | null;
  invoice_date: string | null;
  customer_name: string | null;
  phone: string | null;
  address: string | null;
  postcode: string | null;
  city: string | null;
  state: string | null;
  installation_address: string | null;
  agent_name: string | null;
};

// The agent joins match lib/source-api.ts: linked_agent holds an agent's linked_user_login, an
// agent's own bubble_id, or a user's bubble_id whose linked_agent_profile names the agent.
const SEARCH_SQL = [
  "select i.bubble_id, i.invoice_number, i.invoice_date,",
  "  c.name as customer_name, c.phone, c.address, c.postcode, c.city, c.state,",
  "  s.installation_address,",
  "  coalesce(a.name, user_agent.name, agent_user.name) as agent_name",
  "from invoice i",
  "left join customer c on c.customer_id = i.linked_customer",
  "left join agent a on a.linked_user_login = i.linked_agent or a.bubble_id = i.linked_agent",
  'left join "user" agent_user on agent_user.bubble_id = i.linked_agent',
  "left join agent user_agent on user_agent.bubble_id = agent_user.linked_agent_profile",
  "left join seda_registration s on s.bubble_id = i.linked_seda_registration",
  "where coalesce(i.is_deleted, false) = false",
  "  and (c.name ilike $1 or i.invoice_number ilike $1",
  "       or ($2 <> '' and regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') like '%' || $2 || '%'))",
  "order by i.invoice_date desc nulls last, i.updated_at desc nulls last",
  "limit 20",
].join("\n");

function clean(value: string | null) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

// The customer's own address with postcode, city and state added where the address does not
// already contain them; the SEDA installation address when the customer has none.
function fullAddress(row: Row) {
  const base = clean(row.address);
  if (!base) return clean(row.installation_address);
  const lower = base.toLowerCase();
  const extra = [row.postcode, row.city, row.state]
    .map(clean)
    .filter((part) => part && !lower.includes(part.toLowerCase()));
  return [base.replace(/[,\s]+$/, ""), ...extra].join(", ");
}

export async function GET(request: NextRequest) {
  try {
    await requireUser();
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 401;
    const message = error instanceof AuthError ? error.message : "Not signed in.";
    return NextResponse.json({ error: message }, { status });
  }

  // LIKE wildcards are dropped rather than escaped: the database proxy strips backslashes.
  const term = (request.nextUrl.searchParams.get("q") ?? "")
    .replace(/[\\%_]/g, " ")
    .trim()
    .slice(0, 80);
  if (term.length < 2) return NextResponse.json({ invoices: [] });

  const like = `%${term}%`;
  // Phone search only once at least 4 digits are typed, so a name with a number in it
  // does not match every phone.
  const digits = term.replace(/\D/g, "");
  const phoneDigits = digits.length >= 4 ? digits : "";

  try {
    const rows = await querySource<Row>(SEARCH_SQL, [like, phoneDigits]);
    return NextResponse.json({
      invoices: rows.map((row) => ({
        invoiceNumber: clean(row.invoice_number) || row.bubble_id,
        invoiceDate: row.invoice_date ? String(row.invoice_date).slice(0, 10) : "",
        customerName: clean(row.customer_name),
        phone: clean(row.phone),
        salesperson: clean(row.agent_name),
        address: fullAddress(row),
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not search customers." },
      { status: 503 },
    );
  }
}
