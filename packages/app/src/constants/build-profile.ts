import Constants from "expo-constants";

/** F-Droid build without proprietary camera, notification, or OTA dependencies. */
export const isFdroidBuild = Constants.expoConfig?.extra?.fdroidBuild === true;

/** Independently signed fork build distributed outside the official stores. */
export const isForkBuild = Constants.expoConfig?.extra?.distribution === "fork";
