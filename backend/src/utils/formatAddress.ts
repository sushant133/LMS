import type { AddressSelection } from "@phit-erp/shared";

export const formatAddressLine = (address?: AddressSelection | null): string | undefined => {
  if (!address) {
    return undefined;
  }

  const parts = [
    address.streetAddress,
    address.ward ? `Ward ${address.ward}` : "",
    address.municipality,
    address.district,
    address.province
  ].filter(Boolean);

  return parts.join(", ");
};