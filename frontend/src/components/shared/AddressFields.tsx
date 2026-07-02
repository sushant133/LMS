import { getAllProvinces, getDistrictsByProvince, getMunicipalitiesByDistrict, getWards, type AddressSelection } from "@nepal-school-erp/shared";
import { useTranslation } from "react-i18next";
import { FormField } from "./FormField";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";

interface AddressFieldsProps {
  value: AddressSelection;
  onChange: (value: AddressSelection) => void;
}

export const AddressFields = ({ value, onChange }: AddressFieldsProps) => {
  const { t } = useTranslation();
  const provinces = getAllProvinces();
  const districts = value.province ? getDistrictsByProvince(value.province) : [];
  const municipalities = value.province && value.district ? getMunicipalitiesByDistrict(value.province, value.district) : [];
  const wards = value.province && value.district && value.municipality ? getWards(value.province, value.district, value.municipality) : [];

  // Defensive clearing: if a selected child value no longer exists in the current parent list, clear it.
  // This prevents "stuck" values in cascading dropdowns that look broken to users.
  const isValidDistrict = districts.some((d) => d.en === value.district);
  const isValidMunicipality = municipalities.some((m) => m.en === value.municipality);
  const isValidWard = wards.includes(value.ward);

  const effectiveValue = {
    ...value,
    district: isValidDistrict ? value.district : "",
    municipality: isValidMunicipality ? value.municipality : "",
    ward: isValidWard ? value.ward : ""
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <FormField label={t("province")}>
        <Select
          value={value.province}
          onChange={(event) =>
            onChange({
              province: event.target.value,
              district: "",
              municipality: "",
              ward: "",
              streetAddress: value.streetAddress
            })
          }
        >
          <option value="">Select province</option>
          {provinces.map((province) => (
            <option key={province.en} value={province.en}>
              {province.en}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField label={t("district")}>
        <Select
          key={`district-${value.province}`} // Force remount when province changes → fixes stuck values
          value={effectiveValue.district}
          onChange={(event) =>
            onChange({
              ...value,
              district: event.target.value,
              municipality: "",
              ward: ""
            })
          }
        >
          <option value="">Select district</option>
          {districts.map((district) => (
            <option key={district.en} value={district.en}>
              {district.en}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField label={t("municipality")}>
        <Select
          key={`municipality-${value.province}-${value.district}`}
          value={effectiveValue.municipality}
          onChange={(event) => onChange({ ...value, municipality: event.target.value, ward: "" })}
        >
          <option value="">Select municipality</option>
          {municipalities.map((municipality) => (
            <option key={municipality.en} value={municipality.en}>
              {municipality.en}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField label={t("ward")}>
        <Select
          key={`ward-${value.province}-${value.district}-${value.municipality}`}
          value={effectiveValue.ward}
          onChange={(event) => onChange({ ...value, ward: event.target.value })}
        >
          <option value="">Select ward</option>
          {wards.map((ward) => (
            <option key={ward} value={ward}>
              {ward}
            </option>
          ))}
        </Select>
      </FormField>

      <div className="md:col-span-2">
        <FormField label={t("streetAddress")}>
          <Input value={effectiveValue.streetAddress} onChange={(event) => onChange({ ...effectiveValue, streetAddress: event.target.value })} />
        </FormField>
      </div>
    </div>
  );
};
