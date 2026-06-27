// 직원 프로필 목록(담당자 선택용) — id+name. 누구나 조회 가능(profiles_select_all).
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export interface ProfileLite {
  id: string;
  name: string;
}

export function useProfiles() {
  const [profiles, setProfiles] = useState<ProfileLite[]>([]);
  useEffect(() => {
    let active = true;
    supabase
      .from('profiles')
      .select('id, name')
      .order('name', { ascending: true })
      .then(({ data }) => {
        if (active && data) setProfiles(data.filter((p) => p.name).map((p) => ({ id: p.id, name: p.name })));
      });
    return () => {
      active = false;
    };
  }, []);
  return profiles;
}
