import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useSite } from "../SiteContext";
import { nowInput, offsetDaysInput, validRentalPeriod } from "../data/datetime";

/** 首页查询只收集客户选择，库存与价格通过商品页的正式数据入口确认。 */
export function RentalFinder() {
  const { tenant, href, language } = useSite();
  const en = language === "en";
  const navigate = useNavigate();
  const [category, setCategory] = useState(
    tenant.categories.length === 1 ? tenant.categories[0].id : "all",
  );
  const [store, setStore] = useState("");
  const [start, setStart] = useState(offsetDaysInput(1));
  const [end, setEnd] = useState(offsetDaysInput(3));
  const [error, setError] = useState("");
  const stores =
    tenant.stores?.filter(
      (item) => !item.capabilities || item.capabilities.includes("pickup"),
    ) ?? [];
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!validRentalPeriod(start, end)) {
      setError(
        en
          ? "Choose a future pickup and a later return time."
          : "请选择未来的取货时间，归还时间需晚于取货时间。",
      );
      return;
    }
    const query = new URLSearchParams({ start, end });
    const selectedStore = stores.find((item) => item.id === store);
    if (selectedStore) {
      query.set("pickup", selectedStore.id);
      if (
        !selectedStore.capabilities ||
        selectedStore.capabilities.includes("return")
      )
        query.set("return", selectedStore.id);
      if (selectedStore.city) query.set("city", selectedStore.city);
    }
    navigate(
      href(
        (category === "all"
          ? "/products"
          : `/category/${encodeURIComponent(category)}`) +
          "?" +
          query,
      ),
    );
  }
  return (
    <form
      className="rental-finder"
      aria-label={
        en ? "Find equipment for your rental dates" : "按租期查询商品"
      }
      onSubmit={submit}
    >
      <div className="finder-fields">
        <label className="finder-field">
          <span>{en ? "Equipment" : "商品品类"}</span>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="all">{en ? "All equipment" : "全部商品"}</option>
            {tenant.categories.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        {stores.length > 0 && (
          <label className="finder-field">
            <span>{en ? "Pickup store" : "取货门店"}</span>
            <select
              value={store}
              onChange={(event) => setStore(event.target.value)}
            >
              <option value="">{en ? "Choose later" : "稍后选择"}</option>
              {stores.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="finder-field">
          <span>{en ? "Pickup time" : "取货时间"}</span>
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
        <label className="finder-field">
          <span>{en ? "Return time" : "归还时间"}</span>
          <input
            type="datetime-local"
            value={end}
            min={start}
            required
            onChange={(event) => {
              setEnd(event.target.value);
              setError("");
            }}
          />
        </label>
        <button type="submit" className="button button-dark finder-submit">
          {en ? "Find rentals" : "查找商品"}
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
