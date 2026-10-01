declare module "*.geojson" {
  const value: GeoJSON.FeatureCollection;
  export default value;
}

declare module "@/data/belgium-border.geojson" {
  const value: GeoJSON.FeatureCollection;
  export default value;
}
