import Constants from "expo-constants";

/** F-Droid build without proprietary camera or notification dependencies. */
export const isFdroidBuild = Constants.expoConfig?.extra?.fdroidBuild === true;

/** Production-like Android build with local profiling enabled. */
export const isProfileBuild = Constants.expoConfig?.extra?.profileBuild === true;

/** Fork distribution signed by its own EAS project. */
export const isForkBuild = Constants.expoConfig?.extra?.distribution === "fork";
