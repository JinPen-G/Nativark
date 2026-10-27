/** Authenticated bitmap rendering. Scope changes and denied reads immediately fall back to initials. */
import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { http } from "@/api/http";
import styles from "./CustomerPreview.module.css";

type AvatarBitmap = { blob: Blob; fingerprint: string };

export function CustomerAvatar({ customerId, scope, allowed, fallback }: {
  customerId?: string; scope: string; allowed: boolean; fallback?: ReactNode;
}) {
  const photo=useQuery({
    queryKey:["customer-avatar",scope,customerId,"bitmap-v1"],
    queryFn:async({signal}):Promise<AvatarBitmap>=>{
      const blob=(await http.get<Blob>(`/platform/customers/${encodeURIComponent(customerId!)}/avatar`,{responseType:"blob",signal})).data;
      const digest=await crypto.subtle.digest("SHA-256",await blob.arrayBuffer());
      return {blob,fingerprint:`${blob.type}:${Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join("")}`};
    },
    // Blob identity changes for every HTTP response. Equal bytes under the same
    // authorized query key must not replace the image or its object URL.
    structuralSharing:(previous,next)=>{
      const before=previous as AvatarBitmap|undefined,after=next as AvatarBitmap;
      return before?.fingerprint===after.fingerprint?before:after;
    },
    enabled:Boolean(allowed&&customerId),retry:false,staleTime:30_000,gcTime:60_000,
  });
  const [image,setImage]=useState<{scope:string;source:AvatarBitmap;url:string}>();
  useEffect(()=>{
    if(!allowed||!photo.data||photo.isError)return;
    const url=URL.createObjectURL(photo.data.blob);setImage({scope,source:photo.data,url});
    return()=>URL.revokeObjectURL(url);
  },[allowed,scope,photo.data,photo.isError]);
  return allowed&&!photo.isError&&image?.scope===scope&&image.source===photo.data
    ? <img className={styles.photo} src={image.url} alt="" loading="lazy" /> : <>{fallback}</>;
}
