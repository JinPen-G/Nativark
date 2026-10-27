/** Authenticated bitmap rendering. Scope changes and denied reads immediately fall back to initials. */
import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { http } from "@/api/http";
import styles from "./CustomerPreview.module.css";

export function CustomerAvatar({ customerId, scope, allowed, fallback }: {
  customerId?: string; scope: string; allowed: boolean; fallback?: ReactNode;
}) {
  const photo=useQuery({
    queryKey:["customer-avatar",scope,customerId],
    queryFn:async({signal})=>(await http.get<Blob>(`/platform/customers/${encodeURIComponent(customerId!)}/avatar`,{responseType:"blob",signal})).data,
    enabled:Boolean(allowed&&customerId),retry:false,staleTime:30_000,gcTime:60_000,
  });
  const [image,setImage]=useState<{scope:string;source:Blob;url:string}>();
  useEffect(()=>{
    if(!allowed||!photo.data||photo.isError)return;
    const url=URL.createObjectURL(photo.data);setImage({scope,source:photo.data,url});
    return()=>URL.revokeObjectURL(url);
  },[allowed,scope,photo.data,photo.isError]);
  return allowed&&!photo.isError&&image?.scope===scope&&image.source===photo.data
    ? <img className={styles.photo} src={image.url} alt="" loading="lazy" /> : <>{fallback}</>;
}
