let o;
var t = (r) => {
    if (!o) {
        const n = r.forwardRef(({color: i = "currentColor", size: e = 24, ...l}, s) => {
            return r.createElement("svg", {ref: s, xmlns: "http://www.w3.org/2000/svg", width: e, height: e, viewBox: "0 0 24 24", fill: "none", stroke: i, strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", ...l}, r.createElement("line", {x1: "12", y1: "5", x2: "12", y2: "19"}), r.createElement("line", {x1: "5", y1: "12", x2: "19", y2: "12"}));
        });
        n.displayName = "Plus",o = n;
    }
    return o;
};
const __IsobexMetadata__ = {exports: {default: {type: "reactComponent", slots: [], annotations: {isobexContractVersion: "1"}}, __IsobexMetadata__: {type: "variable"}}};
export { __IsobexMetadata__, t as default };