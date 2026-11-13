import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSite } from "../SiteContext";
import { nowInput, validRentalPeriod } from "../data/datetime";
import { Calendar, ChevronDown, MapPin } from "./SiteIcon";

/** 编辑租赁查询意图，库存与价格由原目录和报价入口核定。 */
export function CatalogConditions({
  params,
  onApply,
  note,
}: {
  params: URLSearchParams;
  onApply: (params: URLSearchParams) => void;
  note: string;
}) {
  const { tenant, language, t } = useSite();
  const en = language === "en";
  const [open, setOpen] = useState(false);
  const [pickup, setPickup] = useState(params.get("pickup") || "");
  const [returnId, setReturnId] = useState(params.get("return") || "");
  const [start, setStart] = useState(params.get("start") || "");
  const [end, setEnd] = useState(params.get("end") || "");
  const [error, setError] = useState("");
  const editButton = useRef<HTMLButtonElement>(null);
  const pickupStores = (tenant.stores ?? []).filter(
    (store) => !store.capabilities || store.capabilities.includes("pickup"),
  );
  const returnStores = (tenant.stores ?? []).filter(
    (store) => !store.capabilities || store.capabilities.includes("return"),
  );
  const currentPickup = pickupStores.find(
    (store) => store.id === params.get("pickup"),
  );
  const currentReturn = returnStores.find(
    (store) => store.id === params.get("return"),
  );

  function resetFields() {
    setPickup(params.get("pickup") || "");
    setReturnId(params.get("return") || "");
    setStart(params.get("start") || "");
    setEnd(params.get("end") || "");
    setError("");
  }

  useEffect(resetFields, [params]);

  function close() {
    resetFields();
    setOpen(false);
    editButton.current?.focus();
  }

  function apply(event: FormEvent) {
    event.preventDefault();
    if (!validRentalPeriod(start, end)) {
      setError(
        en
          ? "Choose a future pickup and a later return time."
          : "请选择未来的取货时间，归还时间需晚于取货时间。",
      );
      return;
    }
    const next = new URLSearchParams(params);
    next.set("start", start);
    next.set("end", end);
    const store = pickupStores.find((item) => item.id === pickup);
    const returnStore = returnStores.find((item) => item.id === returnId);
    if (store) next.set("pickup", store.id);
    else next.delete("pickup");
    if (returnStore) next.set("return", returnStore.id);
    else next.delete("return");
    if (store?.city) next.set("city", store.city);
    else next.delete("city");
    onApply(next);
    setError("");
    setOpen(false);
    editButton.current?.focus();
  }

  return (
    <section
      className="catalog-conditions"
      aria-label={en ? "Rental conditions" : "租赁查询条件"}
    >
      <div className="conditions-summary">
        <div>
          <span>
            <MapPin aria-hidden="true" />
            {currentPickup?.name ||
              (en ? "Store to be confirmed" : "门店待确认")}
            {currentReturn &&
              currentReturn.id !== currentPickup?.id &&
              ` → ${currentReturn.name}`}
          </span>
          <span>
            <Calendar aria-hidden="true" />
            {params.get("start") && params.get("end")
              ? `${params.get("start")!.replace("T", " ")} — ${params.get("end")!.replace("T", " ")}`
              : en
                ? "Choose rental dates"
                : "选择租赁时间"}
          </span>
        </div>
        <button
          ref={editButton}
          className="text-button"
          type="button"
          aria-expanded={open}
          aria-controls="catalog-condition-fields"
          onClick={() => {
            resetFields();
            setOpen(!open);
          }}
        >
          {open ? (en ? "Close" : "收起") : t("conditionEdit")}
          <ChevronDown aria-hidden="true" />
        </button>
      </div>
      {open && (
        <form
          className="conditions-form"
          id="catalog-condition-fields"
          onSubmit={apply}
        >
          <label>
            {en ? "Pickup store" : "取货门店"}
            <select
              value={pickup}
              disabled={!pickupStores.length}
              onChange={(event) => {
                const id = event.target.value;
                setPickup(id);
                if (!returnId || returnId === pickup)
                  setReturnId(
                    returnStores.some((store) => store.id === id) ? id : "",
                  );
                setError("");
              }}
            >
              <option value="">
                {en ? "Confirm when booking" : "预约时确认"}
              </option>
              {pickupStores.map((store) => (
                <option value={store.id} key={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {en ? "Return store" : "归还门店"}
            <select
              value={returnId}
              disabled={!returnStores.length}
              onChange={(event) => {
                setReturnId(event.target.value);
                setError("");
              }}
            >
              <option value="">
                {en ? "Confirm when booking" : "预约时确认"}
              </option>
              {returnStores.map((store) => (
                <option value={store.id} key={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("startDate")}
            <input
              type="datetime-local"
              value={start}
              min={nowInput()}
              required
              onChange={(event) => {
                setStart(event.target.value);
                setError("");
              }}
            />
          </label>
          <label>
            {t("endDate")}
            <input
              type="datetime-local"
              value={end}
              min={start || nowInput()}
              required
              onChange={(event) => {
                setEnd(event.target.value);
                setError("");
              }}
            />
          </label>
          <div className="form-actions">
            <button className="button button-dark" type="submit">
              {en ? "Update search" : "更新查询"}
            </button>
            <button className="text-button" type="button" onClick={close}>
              {en ? "Cancel" : "取消"}
            </button>
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
      <p className="condition-note" role="status">
        {note}
      </p>
    </section>
  );
}
