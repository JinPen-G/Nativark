import { Link } from "react-router-dom";
import { useSite } from "../SiteContext";
import { Clock, MapPin } from "./SiteIcon";
import { PageState } from "./PageState";

/** 公开门店来自当前租户目录，按配置的取货能力提供查询入口。 */
export function StoreDirectory() {
  const { tenant, language, isRemote, href } = useSite();
  const en = language === "en";
  const stores = (tenant.stores ?? []).filter(
    (store) => !store.capabilities || store.capabilities.includes("pickup"),
  );

  return (
    <section
      className="store-directory"
      id="stores"
      aria-labelledby="store-directory-title"
    >
      <div className="section-heading">
        <div>
          <h2 id="store-directory-title">
            {en ? "Stores and collection points" : "门店与取货点"}
          </h2>
          <p>
            {en
              ? "Check the address and opening hours before planning collection."
              : "先看看地址与营业时间，再安排这次取还。"}
          </p>
        </div>
        {!isRemote && (
          <span className="demo-label">
            {en ? "Demo locations" : "演示门店"}
          </span>
        )}
      </div>
      {stores.length ? (
        <div className="store-list">
          {stores.map((store) => {
            const query = new URLSearchParams({ pickup: store.id });
            if (!store.capabilities || store.capabilities.includes("return"))
              query.set("return", store.id);
            if (store.city) query.set("city", store.city);
            return (
              <article className="store-entry" key={store.id}>
                <div>
                  <h3>{store.name}</h3>
                  {store.city && (
                    <span className="quiet-tag">
                      {en ? store.cityEn || store.city : store.city}
                    </span>
                  )}
                </div>
                {store.address && (
                  <p>
                    <MapPin aria-hidden="true" />
                    {store.address}
                  </p>
                )}
                {store.businessHours && (
                  <p>
                    <Clock aria-hidden="true" />
                    {store.businessHours}
                  </p>
                )}
                {isRemote && store.contactPhone && (
                  <p>
                    <a href={"tel:" + store.contactPhone}>
                      {store.contactPhone}
                    </a>
                  </p>
                )}
                <Link className="text-link" to={href("/products?" + query)}>
                  {en ? "Browse equipment for this store" : "从这家门店开始选"}
                  <span className="sr-only"> {store.name}</span>
                </Link>
              </article>
            );
          })}
        </div>
      ) : (
        <PageState
          title={
            en ? "Store information is being prepared" : "公开门店信息正在准备"
          }
        >
          <Link className="button button-outline" to={href("/help")}>
            {en ? "Rental help" : "查看租赁帮助"}
          </Link>
        </PageState>
      )}
    </section>
  );
}
