import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { getAllProvinces, getDistrictsByProvince, getMunicipalitiesByDistrict, getWards } from "@nepal-school-erp/shared";
import { useTranslation } from "react-i18next";
import { FormField } from "./FormField";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
export const AddressFields = ({ value, onChange }) => {
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
    return (_jsxs("div", { className: "grid gap-4 md:grid-cols-2", children: [_jsx(FormField, { label: t("province"), children: _jsxs(Select, { value: value.province, onChange: (event) => onChange({
                        province: event.target.value,
                        district: "",
                        municipality: "",
                        ward: "",
                        streetAddress: value.streetAddress
                    }), children: [_jsx("option", { value: "", children: "Select province" }), provinces.map((province) => (_jsx("option", { value: province.en, children: province.en }, province.en)))] }) }), _jsx(FormField, { label: t("district"), children: _jsxs(Select, { value: effectiveValue.district, onChange: (event) => onChange({
                        ...value,
                        district: event.target.value,
                        municipality: "",
                        ward: ""
                    }), children: [_jsx("option", { value: "", children: "Select district" }), districts.map((district) => (_jsx("option", { value: district.en, children: district.en }, district.en)))] }, `district-${value.province}`) }), _jsx(FormField, { label: t("municipality"), children: _jsxs(Select, { value: effectiveValue.municipality, onChange: (event) => onChange({ ...value, municipality: event.target.value, ward: "" }), children: [_jsx("option", { value: "", children: "Select municipality" }), municipalities.map((municipality) => (_jsx("option", { value: municipality.en, children: municipality.en }, municipality.en)))] }, `municipality-${value.province}-${value.district}`) }), _jsx(FormField, { label: t("ward"), children: _jsxs(Select, { value: effectiveValue.ward, onChange: (event) => onChange({ ...value, ward: event.target.value }), children: [_jsx("option", { value: "", children: "Select ward" }), wards.map((ward) => (_jsx("option", { value: ward, children: ward }, ward)))] }, `ward-${value.province}-${value.district}-${value.municipality}`) }), _jsx("div", { className: "md:col-span-2", children: _jsx(FormField, { label: t("streetAddress"), children: _jsx(Input, { value: effectiveValue.streetAddress, onChange: (event) => onChange({ ...effectiveValue, streetAddress: event.target.value }) }) }) })] }));
};
