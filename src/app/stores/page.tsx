import Link from "next/link";
import { STORE_REGISTRY } from "@/modules/demo-stores";

export default function DemoStoresPage() {
  return (
    <main>
      <h1>Local demo sources</h1>
      <p>Static, allowlisted sources for Actor research and browser demo navigation.</p>
      <ul>
        {STORE_REGISTRY.map((store) => (
          <li key={store.storeId}>
            <Link href={`/stores/${store.storeId}/catalog`}>{store.name}</Link>
            {" "}— {store.sourceClass}, publisher <code>{store.publisherId}</code>
          </li>
        ))}
      </ul>
      <aside>
        Checkout Bundles contains one visibly labelled infected fixture for prompt-injection testing.
      </aside>
    </main>
  );
}
