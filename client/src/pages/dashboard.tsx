import { MapView, ProjectDirectory } from "@/components/map-view";
import { Layout } from "@/components/layout";

export default function Dashboard() {
  return (
    <Layout>
      <div className="w-full p-4 md:p-6 relative">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary/5 via-transparent to-transparent pointer-events-none z-0"></div>
        <div className="relative h-[calc(100vh-3rem)] min-h-[60vh]">
          <MapView />
        </div>
        <ProjectDirectory />
      </div>
    </Layout>
  );
}
