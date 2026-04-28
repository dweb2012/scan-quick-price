import { useEffect, useState } from "react";
import { getActiveAisle, subscribeAisle } from "@/lib/aisle";

export function useActiveAisle(): string | null {
  const [aisle, setAisle] = useState<string | null>(() => getActiveAisle());

  useEffect(() => {
    const update = () => setAisle(getActiveAisle());
    const unsub = subscribeAisle(update);
    update();
    return unsub;
  }, []);

  return aisle;
}