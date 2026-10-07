import { useEffect } from "react";
import { MapView } from "@/components/map-view";

/** Map only, filling the whole iframe: <iframe src="https://…/embed/map"> */
export default function EmbedMap() {
  useEffect(() => {
    document.title = "Illus | Salespoints – kaart";
  }, []);

  return (
    <div className="h-screen w-screen" data-testid="embed-map">
      <MapView embedded />
    </div>
  );
}
