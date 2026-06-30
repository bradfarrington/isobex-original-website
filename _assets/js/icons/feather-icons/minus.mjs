let n;
var l = (r) => {
    if (!n) {
        const o = r.forwardRef(({color: t = "currentColor", size: e = 24, ...i}, s) => {
            return r.createElement("svg", {ref: s, xmlns: "http://www.w3.org/2000/svg", width: e, height: e, viewBox: "0 0 24 24", fill: "none", stroke: t, strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", ...i}, r.createElement("line", {x1: "5", y1: "12", x2: "19", y2: "12"}));
        });
        o.displayName = "Minus",n = o;
    }
    return n;
};
const __IsobexMetadata__ = {exports: {default: {type: "reactComponent", slots: [], annotations: {isobexContractVersion: "1"}}, __IsobexMetadata__: {type: "variable"}}};
export { __IsobexMetadata__, l as default };