import { nepalAddressData } from "./data/nepal-addresses.js";
import type { NepalAddressDistrict, NepalAddressMunicipality, NepalAddressProvince } from "./types.js";

export const getAllProvinces = (): NepalAddressProvince[] => [...nepalAddressData];

export const getDistrictsByProvince = (province: string): NepalAddressDistrict[] =>
  nepalAddressData.find((item) => item.en === province || item.np === province)?.children ?? [];

export const getMunicipalitiesByDistrict = (province: string, district: string): NepalAddressMunicipality[] =>
  getDistrictsByProvince(province).find((item) => item.en === district || item.np === district)?.children ?? [];

export const getWards = (province: string, district: string, municipality: string): string[] =>
  getMunicipalitiesByDistrict(province, district).find((item) => item.en === municipality || item.np === municipality)?.wards ?? [];

