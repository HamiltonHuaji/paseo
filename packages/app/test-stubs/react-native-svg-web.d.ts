// Browser tests load the real web primitives. Use the library's public declarations
// rather than typechecking its unpublished native implementation against our React types.
declare module "react-native-svg/lib/module/elements.web.js" {
  export { default, Circle, Line, Polyline, Polygon, Text } from "react-native-svg";
}
