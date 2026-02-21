import { Service, ServiceScope } from '@elysiumjs/core';
import { Repository } from '@elysiumjs/mnemosyne';

import { UserModel } from '#hero/models/user.model';

@Service.register({ name: 'UserRepository', scope: ServiceScope.SINGLETON })
export class UserRepository extends Repository(UserModel) {}
